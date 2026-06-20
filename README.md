> **Note: this is a dummy README for now — to be updated. Below is the rough outline of the project.**

---

# MediRoute Risk
**A climate-risk early-warning and rerouting tool for the UK's temperature-sensitive medicine supply chain.**
Built for the Health in Climate AI Hackathon, London 2026.

---

## The problem

The UK is almost entirely import-dependent for insulin — there is very limited domestic manufacturing redundancy. Supply is highly concentrated among a small number of manufacturers (principally Novo Nordisk, Eli Lilly, and Sanofi), meaning a disruption at any single point in the chain has an outsized effect on national supply. The UK's actual shortage-response system (DHSC's Medicine Supply Team, the DaSH portal, the National Supply Disruption Response) is triggered by **manufacturers self-reporting a problem**, not by weather forecasts. There is currently no system that says *"this route is forecast to be disrupted in 5 days — act now,"* before a shortage is already underway.

**A note on sourcing for the figures below:** some of the country/route-level specifics in this section come from public trade and industry reporting rather than a single authoritative dataset, and a couple of claims (marked below) couldn't be independently verified in the time available — stated honestly rather than dropped, since the underlying mechanism is sound even where the specific historical incident isn't confirmed.

## Climate vulnerability points across the chain (upstream to downstream)

1. **API manufacturing** — insulin active pharmaceutical ingredient production is concentrated in a small number of European fermentation sites (Novo Nordisk's Danish facilities, Sanofi's Frankfurt site among them). Central European chemical/pharma logistics corridors along the Rhine and Elbe have a documented history of disruption from both flooding and (more commonly documented) low-water/drought conditions affecting barge transport. *Note: the specific claim that the three dominant supply countries to the UK are Netherlands/US/France could not be independently confirmed against trade statistics in the time available — global export data more consistently shows Denmark, the US, and France/Germany as the dominant historical exporters by value. Worth a sharper check before stating this as fact to judges.*

2. **Cold-chain air freight** — insulin requires 2-8°C control and is predominantly air-freighted. Heathrow is the primary UK entry point, meaning a single Heathrow disruption (extreme heat affecting tarmac ground-handling time, or storms grounding flights) can affect multiple suppliers' routes simultaneously rather than being a single-manufacturer problem.

3. **Port routing via the Netherlands** — Rotterdam and Amsterdam Schiphol function as major EU pharmaceutical distribution hubs. North Sea storm activity can delay both sea and air freight through this corridor.

4. **Last-mile cold storage** — NHS Supply Chain's distribution centres in England are DHL-operated (confirmed via NHS Supply Chain's own business continuity documentation, which treats "DHL location" and "NHS Supply Chain HQ" as effectively interchangeable for backup planning) and depend on continuous refrigeration. Heatwaves stress both the cooling infrastructure and the power grid simultaneously. *Note: a specific documented cold-chain failure incident tied to the 2022 UK heatwave could not be confirmed in available sources — the vulnerability mechanism (heat + grid strain + refrigeration dependency) is well-established, but treat this as a plausible risk demonstrated by mechanism, not a cited past event, unless you find a primary source before presenting.*

5. **Demand-supply correlation** — critically, the disruption signal and the demand signal are not independent. Heatwaves degrade glycaemic control in people with diabetes, increasing insulin demand at precisely the moment the cold chain supplying it is most stressed. This compounding effect is one of the more distinctive parts of the pitch — most generic "climate disrupts supply chains" framings miss that demand itself is climate-correlated too.

## Scope for this build

This project models and simulates the **UK insulin and IV fluid (saline) supply chains** specifically — manufacturer through to GP practice and hospital trust endpoints — rather than the full last-mile-only framing from earlier iterations. It is a simulation and proof-of-concept, not a live-tracking system: see the "what's real vs mocked" table below for exactly which parts run on real data today.

## What it does

- Visualises the supply chain for three climate-sensitive medicine categories (Insulin, IV Saline, Immunoglobulins) as a node-and-edge network: manufacturers → UK ports of entry → national warehouse → regional warehouses → hospitals.
- Overlays flood risk across UK regions as a heatmap layer.
- Lets you simulate a climate event (North Sea Storm, UK Heatwave, Rhine Flooding) and watch which nodes/edges become high-risk in response.
- Surfaces a risk summary table per product: origin country, current risk score, which edge of the chain is disrupted, and estimated buffer days of stock remaining.

## Current state — what's real, what's mocked

Being upfront about this matters more than pretending otherwise:

| Component | Status |
|---|---|
| Frontend map, network visualisation, climate event simulator UI | **Built and working** (React + react-leaflet + Tailwind) |
| Flood risk heatmap | **Mocked** — hardcoded lat/lon + risk score points simulating Environment Agency Flood API output |
| Node/edge risk colouring on event change | **Mocked** — simulated response, not yet wired to live data |
| Risk summary table values | **Hardcoded** for 3 demo rows (plausible, not measured) |
| Environment Agency flood data fetch | **Real, working script** (`fetch_environment_agency_flood.py`) — not yet connected to the frontend |
| UKHSA heat/cold alert fetch | **Real script**, path needs on-the-day verification against UKHSA's Swagger docs |
| GDACS global disaster alerts | **Real, working script** (`fetch_gdacs.py`) |
| NHS practice location lookup | **Real, working script** (`fetch_nhs_ods.py`) |
| Insulin/medicine prescribing volume | **Real data**, manually exported from OpenPrescribing (their API explicitly disallows programmatic/AI queries — respected here, not worked around) |
| Risk-routing recommendation engine | **Real, tested logic** (`risk_routing_engine.py`) — builds the node graph, overlays risk, recommends the nearest safe node to redirect volume to. Currently run against sample data, not yet wired to the live frontend |

**In short:** the visual layer and the data layer were built in parallel and are not yet integrated. That integration — wiring the Python data/risk-routing pipeline into the React frontend in place of the mock data file — is the immediate next step, not a hidden gap.

## Architecture

```
┌─────────────────────────┐         ┌──────────────────────────────┐
│   Frontend (React)       │         │   Data & Risk Layer (Python)  │
│   - react-leaflet map    │  <----  │   - fetch_environment_agency  │
│   - node/edge network    │ (not    │     _flood.py                 │
│   - event simulator      │  yet    │   - fetch_ukhsa_weather       │
│   - risk summary table   │  wired) │     _alerts.py                │
│   Currently: mock data   │         │   - fetch_gdacs.py            │
│   in a single data file  │         │   - fetch_nhs_ods.py          │
└─────────────────────────┘         │   - risk_routing_engine.py     │
                                     │   - OpenPrescribing export     │
                                     │     (manual, by design)        │
                                     └──────────────────────────────┘
```

## Setup

### Frontend

```bash
npm install
npm run dev
```

Open the local dev URL shown in your terminal.

### Data/risk layer

```bash
cd scripts
pip install requests gdacs-api networkx --break-system-packages
python fetch_environment_agency_flood.py
python fetch_gdacs.py
python fetch_nhs_ods.py
python risk_routing_engine.py
```

See `scripts/README.md` for the manual OpenPrescribing export steps and a full breakdown of what's live vs. manual per data source.

**Note on network access:** the data-fetch scripts require normal internet access to reach gov.uk/NHS/GDACS endpoints — they will not run inside heavily sandboxed environments with restricted network egress.

## Data sources and attribution

- Environment Agency real-time flood/hydrology data — *"This uses Environment Agency flood and river level data from the real-time data API (Beta)"*
- UK Health Security Agency — Weather-Health Alerting System (Heat-Health and Cold-Health Alerts)
- GDACS (Global Disaster Alert and Coordination System) — UN/EU cooperation framework
- NHS Organisation Data Service (ODS) — Open Government Licence
- OpenPrescribing.net, Bennett Institute for Applied Data Science, University of Oxford — data manually exported per their stated terms (no programmatic/AI querying)
- Met Office Climate Data Portal

This project uses Crown copyright and Open Government Licence data; full attribution is preserved in each fetch script's docstring.

## Known limitations (stated honestly, not buried)

- Supply-chain edges are modelled as straight-line/nearest-neighbour connections, not real road or shipping routes — a placeholder for OSM-based routing, not a final model.
- Severity-to-risk-score weighting in the routing engine is a simple hand-set scale, not a calibrated epidemiological or logistics model.
- Manufacturer site locations are hand-curated from public disclosures, not licensed industry data — verify before citing as fact in any external context.
- Hospital-administered (inpatient) medicine supply is a separate NHS pathway from the community/GP-prescribed route this project models, and is out of scope here.
- This is a hackathon proof-of-concept demonstrating the *mechanism* of climate-aware supply chain routing, not a validated or deployed clinical/operational tool.

## What this would take to go further

A real pilot would mean: validating the risk-routing model retrospectively against actual past DHSC Medicine Supply Notifications, replacing straight-line edges with real OSM road-network routing, and partnering with one NHS Trust or ICB pharmacy team to test whether the redirect recommendations match what their procurement teams would actually do.

## Team

[Add team names here]

## Hackathon

Built at the Health in Climate AI Hackathon, London — UCL School of Management, 20–21 June 2026.
