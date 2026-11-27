"""Run with python server.py. Optional verified reranking uses a locally installed Ollama model."""
import argparse
import json
import os
from functools import lru_cache
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
MODEL = os.environ.get("SYTO_OLLAMA_MODEL", "").strip()
OLLAMA_URL = os.environ.get("SYTO_OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
DIETS = {"vegan", "vegetarian", "egg-free", "dairy-free", "gluten-free", "halal"}


class LocalServer(ThreadingHTTPServer):
    # Several browsers can request the fonts, catalogue and dish photos at the same time.
    request_queue_size = 128


@lru_cache(maxsize=1)
def catalog():
    data = json.loads((ROOT / "static/data/recipes.json").read_text(encoding="utf-8-sig"))
    return {row["id"]: row for row in data}


def string_list(value, limit):
    if not isinstance(value, list) or len(value) > limit or any(not isinstance(x, str) or len(x) > 120 for x in value):
        raise ValueError("Invalid list")
    if len(set(value)) != len(value):
        raise ValueError("Duplicate identifiers")
    return value


def validated_pool(data):
    if not isinstance(data, dict):
        raise ValueError("Invalid body")
    ids = string_list(data.get("ids"), 12)
    products = set(string_list(data.get("products"), 200))
    excluded = set(string_list(data.get("excluded"), 200))
    diet = set(string_list(data.get("diet"), len(DIETS)))
    mode = data.get("mode")
    minutes, budget = data.get("time"), data.get("budget")
    relax = data.get("relax", False)
    if type(relax) is not bool:
        raise ValueError("Invalid consent flag")
    if not ids or not products or not diet <= DIETS or mode not in {"fast", "cheap", "hearty"}:
        raise ValueError("Invalid search")
    if type(minutes) is not int or minutes not in {0,15,20,25,30,45,60}:
        raise ValueError("Invalid time")
    if type(budget) is not int or budget not in {0,50,100,150,200,300,500}:
        raise ValueError("Invalid budget")
    candidates = []
    for rid in ids:
        row = catalog().get(rid)
        if row is None or not diet.issubset(row["tags"]):
            raise ValueError("Candidate not eligible")
        ingredients = {i["id"]: i for i in row["ingredients"]}
        main = {key for key,i in ingredients.items() if not i["pantry"]}
        missing = sorted(main - products)
        if not main.intersection(products) or excluded.intersection(ingredients):
            raise ValueError("Ingredient constraints violated")
        over_time = max(0,row["minutes"]-minutes) if minutes else 0
        over_budget = max(0,row["price"]-budget) if budget else 0
        if (over_time or over_budget) and not relax:
            raise ValueError("Candidate outside limits")
        if not over_time and not over_budget and (relax or not missing):
            raise ValueError("Candidate in wrong group")
        candidates.append({
            "id":rid, "name":row["name"], "minutes":row["minutes"], "rubles":row["price"],
            "satiety":row["hearty"], "family":row["family"], "extra_minutes":over_time, "extra_rubles":over_budget,
            "already_have":[ingredients[i]["name"] for i in sorted(main & products)],
            "to_buy":[ingredients[i]["name"] for i in missing]
        })
    return candidates, mode


def rank(candidates, mode):
    ids = [candidate["id"] for candidate in candidates]
    count = min(len(ids), 5)
    schema = {"type":"object","properties":{"ids":{"type":"array","minItems":count,"maxItems":count,
              "uniqueItems":True,"items":{"type":"string","enum":ids}}},"required":["ids"],"additionalProperties":False}
    instruction = ("Выбери и упорядочь ровно " + str(count) + " разных блюд из переданного каталога. "
        "Сохрани заданный приоритет: fast — меньше минут, cheap — меньшая цена, hearty — большая сытность. "
        "При сравнимом результате предпочти меньше недостающих продуктов и разные блюда. Ответ только JSON с массивом ids.")
    body = {"model":MODEL, "stream":False, "format":schema, "options":{"temperature":0},
            "messages":[{"role":"system","content":instruction},{"role":"user","content":json.dumps(
                {"mode":mode,"candidates":candidates},ensure_ascii=False)}]}
    request = Request(OLLAMA_URL + "/api/chat", data=json.dumps(body).encode(),
                      headers={"Content-Type":"application/json"}, method="POST")
    with urlopen(request, timeout=5) as response:
        answer=json.loads(response.read(65536))
    proposed=json.loads(answer["message"]["content"])["ids"]
    approved=string_list(proposed,count)
    if len(approved)!=count or not set(approved).issubset(ids):
        raise ValueError("Unverified model output")
    return approved


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def respond(self, status, value, content_type="application/json; charset=utf-8", head=False):
        result = value.encode("utf-8") if isinstance(value,str) else json.dumps(value,ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type",content_type)
        self.send_header("Content-Length",str(len(result)))
        self.send_header("Cache-Control","no-store")
        self.send_header("X-Content-Type-Options","nosniff")
        self.end_headers()
        if not head:
            self.wfile.write(result)

    def runtime(self, head=False):
        config = {"rankEndpoint": "/api/rank" if MODEL else None}
        self.respond(200, "window.SYTO_RUNTIME = " + json.dumps(config) + ";", "application/javascript; charset=utf-8",head)

    def do_GET(self):
        if urlsplit(self.path).path == "/static/js/runtime.js":
            return self.runtime()
        return super().do_GET()

    def do_HEAD(self):
        if urlsplit(self.path).path == "/static/js/runtime.js":
            return self.runtime(head=True)
        return super().do_HEAD()

    def do_POST(self):
        if urlsplit(self.path).path != "/api/rank":
            return self.respond(404, {"error":"unknown_endpoint"})
        if not MODEL:
            return self.respond(503, {"error":"model_not_configured"})
        origin = self.headers.get("Origin")
        if origin and urlsplit(origin).netloc != self.headers.get("Host"):
            return self.respond(403, {"error":"origin_mismatch"})
        if self.headers.get_content_type() != "application/json":
            return self.respond(415, {"error":"json_required"})
        try:
            length=int(self.headers.get("Content-Length","0"))
            if not 0 < length <= 32768:
                return self.respond(413, {"error":"invalid_length"})
            data=json.loads(self.rfile.read(length))
            candidates, mode=validated_pool(data)
        except (ValueError, TypeError, KeyError):
            return self.respond(400, {"error":"invalid_candidates"})
        try:
            result=rank(candidates, mode)
        except (URLError, OSError, ValueError, TypeError, KeyError):
            return self.respond(HTTPStatus.SERVICE_UNAVAILABLE, {"error":"verified_ranking_unavailable"})
        self.respond(200, {"ids":result})


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Локальный сайт СытоМастера")
    parser.add_argument("--port",type=int,default=8000)
    args=parser.parse_args()
    server=LocalServer(("127.0.0.1",args.port), Handler)
    print(f"http://127.0.0.1:{server.server_port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

