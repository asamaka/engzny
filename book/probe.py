import requests, time, sys, json
API="https://commons.wikimedia.org/w/api.php"
UA={"User-Agent":"EgyptBookBot/1.0 (https://github.com/asamaka/engzny) python-requests"}
def search(q, n=6):
    r=requests.get(API, params={"action":"query","format":"json","generator":"search",
        "gsrsearch":q,"gsrnamespace":6,"gsrlimit":n,"prop":"imageinfo",
        "iiprop":"url|extmetadata|size","iiurlwidth":1600}, headers=UA, timeout=45)
    out=[]
    for p in r.json().get("query",{}).get("pages",{}).values():
        ii=p.get("imageinfo",[{}])[0]
        em=ii.get("extmetadata",{})
        out.append((p["title"], em.get("LicenseShortName",{}).get("value","?"),
                    ii.get("width"), ii.get("height"),
                    (em.get("Artist",{}).get("value","") or "")[:60]))
    return out
for q in sys.argv[1:]:
    print("=== "+q)
    for t in search(q): print("   ", t)
    time.sleep(1)
