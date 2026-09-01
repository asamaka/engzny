import requests, time
API="https://commons.wikimedia.org/w/api.php"
UA={"User-Agent":"EgyptBookBot/1.0 (https://github.com/asamaka/engzny) python-requests"}
S=requests.Session(); S.headers.update(UA)
def get(url, **kw):
    for a in range(6):
        try:
            r=S.get(url, timeout=60, **kw)
            if r.status_code==200: return r
            st=r.status_code
        except Exception as e:
            st=repr(e)[:60]
        time.sleep(1.5*(a+1))
    print("  !! failed", st, kw.get("params",{}).get("gsrsearch") or url[:80])
    return None
def search(q, n=6):
    r=get(API, params={"action":"query","format":"json","generator":"search",
        "gsrsearch":q,"gsrnamespace":6,"gsrlimit":n,"prop":"imageinfo",
        "iiprop":"url|extmetadata|size","iiurlwidth":1600})
    if not r: return []
    out=[]
    for p in r.json().get("query",{}).get("pages",{}).values():
        ii=(p.get("imageinfo") or [{}])[0]; em=ii.get("extmetadata",{})
        out.append({"title":p["title"],"lic":em.get("LicenseShortName",{}).get("value","?"),
            "w":ii.get("width"),"h":ii.get("height"),
            "artist":em.get("Artist",{}).get("value",""),
            "desc":em.get("ImageDescription",{}).get("value","")})
    return out
