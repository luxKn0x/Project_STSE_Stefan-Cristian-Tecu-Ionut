const express = require("express");
const cors = require("cors");
const { Client } = require("@elastic/elasticsearch");

const app = express();
app.use(cors());

const es = new Client({ node: "http://localhost:9200" });
// Dacă ai security ON:
// const es = new Client({ node:"http://localhost:9200", auth:{ username:"elastic", password:"PAROLA" } });

// Healthcheck: arată exact structura răspunsului primit de client
app.get("/health", async (_req, res) => {
  try {
    const resp = await es.info();
    const body = resp.body ?? resp;
    res.json({ ok: true, version: body.version?.number, tagline: body.tagline, rawKeys: Object.keys(body) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.meta?.body || e.message || String(e) });
  }
});

app.get("/search", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.json({ took: 0, hits: [], suggestions: [] });

  try {
    const sRes = await es.search({
      index: "addresses",
      size: 10,
      body: {
        query: {
          bool: {
            should: [
              {
                multi_match: {
                  query: q,
                  fields: ["full^3", "street^2", "city", "county"],
                  fuzziness: "AUTO",
                  prefix_length: 1
                }
              },
              {
                match_phrase_prefix: {
                  full: { query: q, slop: 2, max_expansions: 50 }
                }
              }
            ]
          }
        }
      }
    });

    const gRes = await es.search({
      index: "addresses",
      body: {
        suggest: {
          addr: {
            prefix: q,
            completion: { field: "full_suggest", skip_duplicates: true, size: 5 }
          }
        }
      }
    });

    // Compat: client v8 (resp.body) sau direct (resp)
    const sBody = sRes.body ?? sRes;
    const gBody = gRes.body ?? gRes;

    const hitsArr = Array.isArray(sBody?.hits?.hits) ? sBody.hits.hits : [];
    const hits = hitsArr.map(h => ({ id: h._id, full: h._source?.full, score: h._score }));

    const suggestArr = gBody?.suggest?.addr?.[0]?.options ?? [];
    const suggestions = suggestArr.map(o => o.text);

    res.json({ took: sBody?.took ?? 0, hits, suggestions });
  } catch (e) {
    console.error("[/search] error:", e);
    res.status(500).json({ error: e.meta?.body || e.message || String(e) });
  }
});

app.listen(3000, () =>
  console.log("🚀 Address Finder API running on http://localhost:3000")
);
app.get("/search", async (req, res) => {
  const q = (req.query.q || "").trim();
  const city = (req.query.city || "").trim();
  const postal = (req.query.postal || "").trim();
  if (!q) return res.json({ took: 0, hits: [], suggestions: [] });

  try {
    const mustFilters = [];
    if (city)   mustFilters.push({ term: { "city.keyword": city }});
    if (postal) mustFilters.push({ term: { "postal_code": postal }});

    const sRes = await es.search({
      index: "addresses",
      size: 10,
      body: {
        query: {
          bool: {
            must: mustFilters,
            should: [
              { multi_match: { query: q, fields: ["full^3","street^2","city","county"], fuzziness: "AUTO", prefix_length: 1 } },
              { match_phrase_prefix: { full: { query: q, slop: 2, max_expansions: 50 } } }
            ]
          }
        }
      }
    });

    const gRes = await es.search({
      index: "addresses",
      body: { suggest: { addr: { prefix: q, completion: { field: "full_suggest", skip_duplicates: true, size: 5 }}}}
    });

    const sBody = sRes.body ?? sRes, gBody = gRes.body ?? gRes;
    const hits = (sBody.hits?.hits||[]).map(h => ({ id:h._id, full:h._source.full, score:h._score }));
    const suggestions = (gBody.suggest?.addr?.[0]?.options||[]).map(o => o.text);
    res.json({ took: sBody.took||0, hits, suggestions });
  } catch (e) { res.status(500).json({ error: e.meta?.body || e.message || String(e) }); }
});
