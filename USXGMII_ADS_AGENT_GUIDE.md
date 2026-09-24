# GPY241 ↔ VSC7558 USXGMII Full-Channel Simulation in Keysight ADS

## Purpose

This is a research and execution brief for an engineering agent. Its goal is to produce a reproducible, bidirectional signal-integrity analysis of the serial host link between a MaxLinear GPY241 quad 2.5 GbE PHY and a Microchip VSC7558 switch in Keysight ADS.

The correct VSC7558 mode for one GPY241 aggregating four ports is **10G-QXGMII**, the four-port form of multiport USXGMII. It carries four logical 10/100/1000/2500 Mb/s ports over one 10.3125 Gb/s NRZ SerDes lane in each direction. Do not silently substitute single-port USXGMII, ordinary XFI/SFI, QSGMII, or four independent 2.5G SGMII links.

This guide covers electrical channel simulation. ADS Channel Simulator does not by itself prove PCS framing, USXGMII ordered-set handling, logical-port mapping, autonegotiation, or driver/register correctness. Those need a separate protocol/configuration and hardware-validation plan.

## 1. Facts already established

| Item | Established value | Engineering consequence |
|---|---:|---|
| Interface | VSC7558 `10G-QXGMII`; MaxLinear markets it as `USXGMII-4×2.5G` | Four logical PHY ports share one serial lane pair in each direction. |
| Physical signaling | NRZ, 64b/66b, 10.3125 Gb/s | UI = 96.9697 ps; Nyquist = 5.15625 GHz. |
| Physical conductors | One TX differential pair plus one RX differential pair | Four high-speed signal pins at each device, not four serial lanes. |
| Nominal differential impedance | 100 Ω | Extract and simulate as a 100 Ω differential system; single-ended S-parameter ports are normally 50 Ω each. |
| Coupling | AC coupling is required | Model the actual capacitor part, pads, placement, and mounting discontinuity in both directions. |
| Cisco link objective | BER 10^-15 | Directly simulating a few million bits cannot demonstrate this; use statistical AMI/BER contours and hardware correlation. |
| Cisco channel loss exception | Maximum insertion loss 15 dB at 5 GHz | Use as a provisional hard passive-channel screening limit, but also report loss at the exact 5.15625 GHz Nyquist point. A 15 dB loss is a voltage-wave magnitude of about 0.1778. |
| Cisco crosstalk metric | ICR threshold shown as 15 dB at 5 GHz | The public copy says “maximum ICR,” while its formula/figure make larger ICR the favorable direction. Treat 15 dB as a provisional lower-bound threshold and obtain vendor confirmation before sign-off. |
| GPY241 RX pins | C25 `URXP`, C24 `URXM` | Include correct package pins and polarity. |
| GPY241 TX pins | D25 `UTXP`, D24 `UTXM` | Include correct package pins and polarity. |
| GPY241 SerDes calibration | B24 `URESREF`, external 200 Ω ±1% reference resistor | This affects silicon behavior; it is not part of the routed differential channel, but must match the hardware and model assumptions. |
| VSC7558 eligible lanes | S17–S32 for 10G-QXGMII | S17–S24 are native 10G SerDes; S25–S32 are 25G SerDes that can run the 10.3125 Gb/s mode. Do not assume their AMI/package models are identical. |
| Example VSC7558 lane | S17: C24 `TXP`, B24 `TXN`, F24 `RXP`, E24 `RXN` | Use only as an example. Extract the lane and balls actually used by the schematic/netlist. |

The line rate remains 10.3125 Gb/s even when an attached copper port negotiates 10M, 100M, 1G, or 2.5G. Lower logical rates are carried by replication/multiplexing. Therefore, the electrical worst-case simulation is not rerun at 2.5 Gb/s; it remains a 10.3125 Gb/s link. The lower-rate cases matter to protocol and buffering validation.

Primary support: [Cisco USXGMII Single-Port Copper Interface, §2.9](https://community.cisco.com/kxiwq67737/attachments/kxiwq67737/5931-discussions-network-management/149865/2/USXGMII_Singleport_Copper_Interface.pdf), [MaxLinear GPY241 data sheet Rev. 1.7](https://www.maxlinear.com/Document/index?id=23386&languageid=1033&partnumber=GPY241&type=Data+Sheets), and [Microchip SparX-5 family data sheet Rev. C](https://ww1.microchip.com/downloads/en/DeviceDoc/SparX-5_Family_L2L3_Enterprise_25G_Ethernet_Switches_Datasheet_00003823C.pdf). The public Cisco electrical limits come from the single-port document, while this device pairing uses the multiport specification. Use those limits provisionally and obtain the current controlled **USXGMII Multiport Copper Interface** revision or written vendor confirmation for final sign-off.

## 2. Device-specific electrical information

### 2.1 GPY241

The official Rev. 1.7 data sheet identifies the device as a quad Ethernet PHY with a single-lane 10.3125 GHz-bit-clock USXGMII interface. It requires an additional 1.8 V rail for USXGMII and its low-jitter PLL. The USXGMII pins must be AC-coupled and use an integrated CDR, so no forwarded serial clock is present.

Published endpoint requirements include:

- 100 Ω reference differential impedance and no more than 5% termination mismatch.
- TX 20–80% rise/fall time of at least 24 ps.
- TX RMS AC common-mode voltage no more than 15 mV.
- RX RMS AC common-mode voltage no more than 25 mV.
- Differential return-loss mask of 20 dB from 0.05–0.1 GHz and then `10 − 16.6·log10(f/7.5)` dB through 7.5 GHz, with `f` in GHz. The formula reaches 10 dB at 7.5 GHz and about 12.70 dB at the 5.15625 GHz Nyquist frequency.
- Common-mode return loss of 6 dB from 0.1–15 GHz.
- RX differential-to-common-mode conversion requirement of 12 dB from 0.1–15 GHz.
- Automatic RX/TX equalization values for “standard” reach selections and API-programmed values for custom trace lengths. The public data sheet does not provide the mapping needed to reproduce those settings.

The data sheet cites two essential non-public/support documents: **Ethernet Network Connection GPY API V2.7.1.2** and **EASY GPY241 LBB Reference Board V2.1.1 HDK HW6.1.02 Hardware Design Guide Rev. 1.0**. Obtain the newest equivalents.

### 2.2 VSC7558

The VSC7558 implements 10G-QXGMII as four logical 2.5G ports on one 10.3125 Gb/s SerDes. Up to 16 such instances can be configured on S17–S32. For USXGMII extender `n = 16…31`, the data sheet describes enabling `PORT_CONF:HW_CFG:USXGMII_ENA[n]` and selecting quad-port mode with `PORT_CONF:USXGMII_CFG[n]:USXGMII_CFG.NUM_PORTS = 2`. The exact driver/SDK procedure and any errata must be taken from the revision used in the product.

Published VSC7558 SerDes data includes:

- 80–120 Ω differential resistance, 100 Ω typical.
- USXGMII TX differential swing 800–1200 mVppd, register configurable.
- RX clean-eye input range 100–1200 mVppd.
- AC coupling on every SerDes input/output; the data sheet shows 100 nF and says coupling should be at the receiver.
- TX 3-tap FIR/FFE and amplitude control.
- RX variable gain, programmable CTLE, and a 5-tap DFE supporting adaptive or manual operation.
- Built-in RX eye monitor, PRBS generator/checker, loopbacks, and polarity inversion.
- A 156.25 MHz ±100 ppm reference clock for the relevant SerDes bank. REFCLK1 covers S0–S16 and REFCLK2 covers S17–S32. The hardware checklist says the P/N reference-clock inputs must be AC-coupled.

The public [SparX-5/5i Hardware Design Checklist](https://ww1.microchip.com/downloads/en/DeviceDoc/SparX-5-5i-HW-Design-Checklist-00003911.pdf) additionally recommends simulation of all 10G/25G traces, surface-layer routing where possible to avoid via/connector stubs, no 90° bends, and attention to polarity, direction, and AC coupling. The exact GPY241/VSC7558 combination is demonstrated by the [VSC5641EV reference board](https://www.microchip.com/en-us/tools-resources/reference-designs/56-port-ethernet-switch-with-48x-1g-cu-4x-sfp28-and-4x-2-5g-cu-reference-design), although its design files require access approval.

## 3. Definition of “full channel”

The agent must declare one of these boundaries before presenting results:

1. **Die-to-die active full channel — sign-off candidate**: VSC7558 TX analog/AMI + VSC package + PCB/capacitors + GPY package + GPY241 RX analog/AMI, and the reverse direction with the roles swapped.
2. **Ball-to-ball passive channel — layout qualification**: PCB, pads, vias, capacitors, connectors/test fixtures, and crosstalk, with ports at the BGA balls. This cannot establish receiver BER or equalized eye margin.
3. **Behavioral active approximation — design exploration**: passive channel plus a documented surrogate TX/RX equalization and jitter model built from public limits. This must not be labeled vendor-silicon sign-off.

Never combine package loss already embedded in an IBIS-AMI model with a separate package S-parameter model. Inspect the IBIS `[Package]`, `[Package Model]`, `[Algorithmic Model]`, and model readme to determine the reference plane.

Run two independent links:

- `VSC7558_TX → GPY241_RX`
- `GPY241_TX → VSC7558_RX`

They are not interchangeable because transmitter swing/equalization, receiver adaptation, package breakouts, capacitor locations, and aggressor coupling can differ.

## 4. Required input package

### 4.1 From MaxLinear

- GPY241B0BC IBIS-AMI TX and RX models for the USXGMII interface, compiled for the operating system and bitness used by ADS.
- Package S-parameters or an IBIS package model for C24/C25/D24/D25, with reference-plane documentation.
- Model readme identifying PVT corners, supported AMI flow (Init/statistical and/or GetWave/bit-by-bit), valid bit rate, reach/equalization parameters, ignored/adaptation bits, and whether jitter and package are included.
- Current GPY API and the GPY241 reference-board hardware design guide cited above.
- The current controlled Cisco USXGMII Multiport Copper Interface specification/revision used by GPY241.
- Exact definitions and settings for `VSPEC1_SGMII_CTRL.USXGMII_REACH`, RX/TX equalization, TX swing, and PRBS/test modes.
- Vendor-provided vertical/horizontal eye-opening limits at BER 10^-15. The Cisco specification explicitly assigns these limits to the IP vendor.

### 4.2 From Microchip

- VSC7558 SerDes IBIS-AMI TX/RX models for the exact lane class used: SERDES10G or SERDES25G operating at 10.3125 Gb/s.
- VSC7558 888-FCBGA package model for the selected Sxx TX/RX balls, including breakout/reference-plane documentation.
- VSC5641EV schematic, PCB layout/ODB++, BOM, and any simulation package that demonstrates the supported GPY241 connection.
- Current SDK/MESA configuration sequence for 10G-QXGMII and the chosen port map.
- The latest SparX-5 data-sheet revision and any controlled USXGMII/QXGMII electrical addendum; the publicly retrievable Rev. C used here is not assumed to be the latest sign-off document.
- Mapping from register values to TX amplitude and three FFE taps; RX VGA, CTLE, and five DFE taps/adaptation; PRBS and internal-eye readout.
- Vendor eye/BER acceptance limits and any errata affecting USXGMII/QXGMII.

### 4.3 From the board project/fabricator

- Native PCB database or ODB++/IPC-2581 export with actual stackup.
- Frequency-dependent Dk/Df, resin content/glass style if available, copper foil type and roughness model/parameters, finished copper thickness, solder mask, and fabrication tolerances.
- Actual net names, VSC SerDes number, BGA balls, GPY241 pins, polarity swaps, and high-speed component references.
- Exact AC-coupling capacitor manufacturer/part/value/package/tolerance and population option.
- All vias, backdrills, unused pads, test pads, probes, zero-ohm options, connectors, and plane transitions.
- Neighboring high-speed nets and clocks to be treated as aggressors.
- Fabrication coupon/TDR and, when hardware exists, VNA S-parameters or de-embedded TDR.

If any item is unavailable, record it as a limitation and downgrade the result category. Do not invent a model or silently use a generic XFI/KR device model.

## 5. ADS workflow

ADS product/menu names vary by release. Record the exact ADS build and installed licenses before work. Keysight identifies S-parameter, transient, Channel Simulator, SIPro, and controlled-impedance/via tools as the relevant high-speed-digital capabilities. SIPro can extract coupled signal nets, power/ground returns, vias, and plane discontinuities into an EM model that feeds ADS Channel Simulator. See the [Keysight HSD/SIPro bundle description](https://www.keysight.com/zz/en/product/W3625B/pathwave-ads-core-em-design-layout-hsd-ckt-sim-sipro-pipro.html) and [SIPro technical description](https://www.keysight.com/at/de/assets/7018-05074/data-sheets/5992-1291.pdf).

### Phase A — topology audit

1. Read the schematic and netlist. Confirm a single four-port 10G-QXGMII link, the selected VSC S17–S32 lane, GPY241 UTX/URX pins, P/N orientation, and which device receives each pair.
2. Confirm exactly one intended AC-coupling capacitor per conductor in each direction. Do not add a second pair merely because both data sheets say AC-coupled.
3. Record channel reference planes. Mark which physical structures are in the board extraction, package models, capacitor models, and AMI analog front ends.
4. Record every nearby aggressor and its real operating mode. Include coupling across BGA escapes, vias, long parallel routes, and connectors—not only parallel traces.

### Phase B — pre-layout model

1. Build a parametric 100 Ω differential channel using the intended stackup, trace geometry, actual length, vias, and capacitors.
2. Use the fabrication material model and copper roughness; do not use generic FR-4 if vendor data exists.
3. Sweep trace width/spacing, via antipad and stub/backdrill, layer choice, reference transitions, capacitor footprint, and spacing to aggressors.
4. Use the pre-layout model to set routing constraints, not to declare final compliance.

### Phase C — post-layout EM extraction

1. Import the PCB database into ADS/SIPro. Verify units, stackup, materials, conductor plating, roughness, solder mask, drill/backdrill, and component mapping.
2. Select both victim directions and all material aggressors in one coupled extraction where practical. Include their reference planes and stitching/return vias.
3. Place ports at the declared package/ball boundary. Avoid arbitrary cuts that remove return-current discontinuities.
4. Use a frequency sweep extending from sufficiently low frequency for accurate baseline/step response through at least 15 GHz, because GPY241 publishes endpoint requirements to 15 GHz. A 20 GHz or higher stop frequency is preferable when the geometry/model quality supports it. Use adequate low-frequency and harmonic coverage rather than a sparse sweep centered only on 5 GHz.
5. Export a Touchstone model retaining single-ended ports so mixed-mode conversion and common-mode behavior can be computed. Preserve port order in a machine-readable map.

### Phase D — passive-channel qualification

1. Check reciprocity where applicable, passivity, causality, and convergence against a finer mesh/sweep. Do not use passivity enforcement to conceal a materially bad extraction.
2. Convert to mixed mode and plot at minimum:
   - `SDD21/SDD12` insertion loss for each direction
   - `SDD11/SDD22` differential return loss
   - near- and far-end differential crosstalk from every aggressor
   - power-sum crosstalk and ICR
   - `SCD`, `SDC`, and `SCC` mode conversion/common-mode terms
   - group delay and phase smoothness
   - differential TDR/TDT, including every package escape, via, capacitor, and connector
3. Report insertion loss at 5.000 GHz, 5.15625 GHz, 10.3125 GHz, and 15.46875 GHz when the model bandwidth is adequate.
4. Calculate ICR using the definition used by the governing specification and state all sign conventions. Do not report `IL − PSXT` under an `−IL + PSXT` label without reconciling whether quantities are signed S-parameters or positive losses.
5. Compare the GPY241 endpoint return-loss and mode-conversion masks separately from the interconnect channel response. Do not apply an endpoint specification to the PCB alone without saying so.

### Phase E — active Channel Simulator testbench

Use the topology `Tx_AMI → Tx package → extracted PCB/capacitors/aggressors → Rx package → Rx_AMI`, with probes at documented points. Keysight’s published examples use TX/RX AMI blocks, an n-port S-parameter channel, eye probes, and a ChannelSim controller; see [Signal Integrity Simulation Using ADS](https://www.keysight.com/us/en/assets/7018-05136/application-notes/5992-1379.pdf) and [Keysight’s IBIS-AMI flow paper](https://docs.keysight.com/download/attachments/592984474/Explore_the_SERDES_design_space_using_the_IBIS_AMI_channel_simulation_flow_v6.pdf?api=v2).

For each direction:

1. Load the exact TX/RX model pair and validate that the AMI executable loads without parser warnings.
2. Set 10.3125 Gb/s, NRZ/PAM2, and 96.9697 ps UI. Do not simulate at 2.5 Gb/s merely because each logical port is 2.5G.
3. Start with the vendor’s recommended default/reach settings. Then sweep legal TX amplitude/FFE and RX adaptation/manual settings.
4. Run both statistical/Init and bit-by-bit/GetWave modes when supported. Statistical mode is required for very low BER contours; bit-by-bit mode exposes adaptation, nonlinear/time-varying behavior, and pattern sensitivity.
5. Use a PRBS31 stress pattern unless the vendor supplies a USXGMII-specific 64b/66b stimulus recommendation. Also run a standards-representative 64b/66b stream when available. Clearly distinguish physical stress patterns from a protocol-valid stream.
6. Discard the model-specified adaptation/ignore interval before measuring. Record all AMI parameters and random seeds.
7. Add realistic independent jitter and crosstalk only when not already included in the AMI models. Prevent double-counting. Reference-clock input jitter is not automatically equal to serial-output jitter.
8. Produce density eyes, eye width/height versus BER, bathtub curves, BER contours, pulse/step/impulse responses, and the selected equalizer settings.
9. Repeat at PVT/model corners and material/geometry tolerances. Include at least typical, expected worst-loss, expected worst-reflection, and expected worst-crosstalk cases.

### Phase F — fallback when AMI is unavailable

The agent may still complete the passive extraction and build an exploratory model with a bounded TX source, package approximation, FFE/CTLE/DFE, receiver threshold, and jitter. Every parameter must be tied to a published device limit or explicitly labeled an assumption. Results are useful for layout ranking only. They must be titled **behavioral approximation—not device sign-off**.

## 6. Acceptance matrix

| Check | Pass criterion | Status before vendor models |
|---|---|---|
| Mode/topology | GPY241 ↔ VSC7558 configured as one 10G-QXGMII lane carrying four ports | Can be checked from schematic/SDK. |
| Line rate | 10.3125 Gb/s in every logical port-speed case | Established. |
| Impedance | 100 Ω nominal differential; discontinuities reviewed against board/vendor limits | Board-specific limit still needed. |
| Insertion loss | No more than 15 dB at 5 GHz | Public Cisco criterion. |
| ICR | Provisional favorable-side threshold of 15 dB at 5 GHz | Confirm wording/direction with controlled spec/vendor. |
| AC coupling | Correct value and one intended pair per direction, located/modelled as built | Schematic/BOM required. |
| GPY241 endpoint RL/conversion | Meets Rev. 1.7 Tables 49–50 across stated bands | Endpoint/package model required. |
| VSC7558 electrical range | TX 800–1200 mVppd and RX clean-eye input 100–1200 mVppd, with correct termination | Necessary but not sufficient for BER. |
| BER | ≤10^-15 in both directions at required corners | Requires valid vendor AMI/criteria or hardware BERT evidence. |
| Eye opening | Meets vendor-provided horizontal and vertical limits at the target BER | Limits are not public; request them. |
| Robustness | Pass across component, stackup, material, PVT, legal EQ settings, and simultaneous crosstalk cases | Full model/tolerance set required. |
| Correlation | Simulated passive response and internal eye/BER trends correlate with coupon/VNA/TDR/PRBS hardware data | Hardware required. |

Do not create an arbitrary eye mask and call it USXGMII compliance. The Cisco document requires the SerDes/IP vendor to provide vertical and horizontal eye-opening pass/fail values.

## 7. Hardware correlation plan

1. On an unpowered or properly isolated board, measure impedance/TDR and de-embedded insertion/return loss with appropriate coupons or fixtures.
2. Compare measured and simulated S-parameters at identical reference planes. Reconcile material loss, roughness, via geometry, capacitor ESL, fixture de-embedding, and package inclusion.
3. Configure VSC7558 PRBS generator/checker and GPY241 test functions using vendor procedures. Test both directions, all legal EQ presets, voltage/temperature corners where practical, and meaningful run duration.
4. Capture VSC7558 internal RX eye scans with fixed PRBS, because the data sheet recommends a fixed pattern for repeatability. Do not leave the eye monitor active during normal service; its equalizers are frozen during a scan.
5. Correlate the relative effect of TX FFE, RX CTLE/DFE, temperature, and aggressors—not only one nominal eye screenshot.
6. Separately verify USXGMII/QXGMII autonegotiation, all four logical ports, 10/100/1000/2500 modes, full traffic, pause/rate adaptation, resets, and error recovery. This is not an ADS channel result.

## 8. Required deliverables from the agent

The final engineering package must contain:

1. A one-page decision summary with pass/fail/provisional status for each direction.
2. Exact topology, selected VSC SerDes/lane, logical-port map, pins/balls, polarity, AC-cap parts and placement, and reference planes.
3. Model manifest with file hashes, versions, OS/bitness, licensing restrictions, package inclusion, and model limitations.
4. PCB/stackup/material manifest and extraction settings.
5. Port map for every Touchstone file.
6. Passive plots and a numeric margin table.
7. Active eye/BER/bathtub results for both directions and all required corners.
8. Equalizer-setting sweep and recommended robust operating point—not merely the best nominal point.
9. Sensitivity ranking showing which geometry, material, aggressor, and EQ variables dominate margin.
10. Correlation report or a clearly marked pending-correlation plan.
11. Register/configuration checklist for VSC7558 and GPY241, kept separate from SI compliance.
12. Open issues and exact vendor questions. Use `NOT FOUND` for unavailable data; never infer vendor limits from a different chip.

All plots must show units, reference plane, direction, corner, model versions, and pass/fail line. Preserve the ADS workspace, datasets, scripts/equations, extraction database, and a README that reproduces the run.

## 9. Agent research plan tailored to this repository

Use Deep mode. The evidence requirement is claim-specific: vendor data sheets and controlled support files for device facts; Cisco/IEEE material for the interface; Keysight documentation for ADS behavior; actual board/fabricator files for geometry; measurements for correlation.

Suggested independent tasks (no more than two retrieval workers concurrently under the current agent rules):

- **protocol_acceptance** — Resolve single-port versus multiport nomenclature; extract 10G-QXGMII rate, coding, BER, insertion-loss, ICR, coupling, and any controlled-spec ambiguity.
- **gpy241_models** — Inventory public and support-gated GPY241 electrical data, pins, reference design, API, EQ controls, IBIS-AMI/package models, and eye criteria.
- **vsc7558_models** — Establish eligible lanes and mapping, DC/AC limits, EQ/test features, package/AMI assets, SDK configuration, reference design, and errata.
- **ads_flow** — Produce a version-aware ADS/SIPro flow for coupled extraction, mixed-mode checks, AMI statistical/GetWave simulations, sweeps, and reproducibility.
- **board_evidence** — Read the user’s schematic/layout/stackup/BOM and construct the as-built channel and aggressor map.
- **verification** — Check every numeric limit against the cited passage and confirm that the final conclusion does not promote a passive or surrogate model to silicon sign-off.

### Ready-to-paste `/research` prompt

```text
/research mode: deep | Develop a complete, evidence-backed engineering plan and execution guide for bidirectional full-channel signal-integrity simulation in Keysight ADS of the host interface between a MaxLinear GPY241B0BC quad 2.5GbE PHY and a Microchip VSC7558 MAC/switch.

Treat the intended topology as one GPY241 carrying four logical 10/100/1000/2500 ports over the VSC7558 10G-QXGMII multiport USXGMII mode: one 10.3125 Gb/s NRZ, 64b/66b differential lane in each direction. First verify this topology against the schematic/netlist and current vendor documents. Do not conflate it with single-port USXGMII, XFI/SFI, QSGMII, or four independent SGMII+ lanes.

The report must: (1) define die-to-die, ball-to-ball, and behavioral-approximation boundaries; (2) identify the actual VSC SerDes number, balls, port map, GPY241 UTX/URX pins, polarity, and AC-coupling parts/placement; (3) gather current Cisco/interface, MaxLinear, Microchip, and Keysight primary documentation; (4) inventory and request exact IBIS-AMI, package, equalizer, jitter, eye-limit, SDK/API, and reference-design assets; (5) give a precise ADS/SIPro pre-layout and post-layout workflow including stackup/material/copper-roughness setup, coupled EM extraction, port/reference-plane management, frequency range, passivity/causality checks, mixed-mode S-parameters, TDR, insertion/return loss, mode conversion, crosstalk, PSXT and ICR; (6) build separate VSC7558-TX→GPY241-RX and GPY241-TX→VSC7558-RX AMI Channel Simulator plans at 10.3125 Gb/s using statistical and bit-by-bit modes, legal TX FFE/amplitude and RX VGA/CTLE/DFE sweeps, PRBS31 and representative 64b/66b traffic, PVT/material/geometry/crosstalk corners, and no double-counting of package or jitter; (7) use BER ≤10^-15, the public 15 dB insertion-loss limit at 5 GHz, the provisionally interpreted 15 dB ICR threshold at 5 GHz, GPY241 endpoint return-loss/mode-conversion masks, and vendor-provided eye limits; (8) distinguish what ADS can prove from protocol/autonegotiation/driver testing; and (9) provide a hardware correlation plan using VNA/TDR, PRBS/BERT, VSC7558 internal eye monitor, and both directions.

Never claim sign-off without correct vendor TX/RX and package models plus vendor eye criteria. Grade outcomes as vendor-AMI sign-off candidate, behavioral design exploration, or passive-channel screening. Record unavailable facts as NOT FOUND, surface contradictions (especially ICR wording and USXGMII/QXGMII naming), and give exact vendor questions. Deliver a concise decision summary, numeric requirements table, model and board-input manifest, step-by-step ADS procedure, corner matrix, result-table template, register/configuration checklist, reproducibility checklist, and cited source list.
```

## 10. Source set

All sources below were accessed 2026-09-24.

1. Cisco, [USGMII/USXGMII portal](https://developer.cisco.com/site/usgmii-usxgmii/) and [USXGMII Single-Port Copper Interface, public attachment](https://community.cisco.com/kxiwq67737/attachments/kxiwq67737/5931-discussions-network-management/149865/2/USXGMII_Singleport_Copper_Interface.pdf), especially pp. 5 and 28–30.
2. MaxLinear, [GPY241 product page](https://www.maxlinear.com/product/interface/ethernet/ethernet-transceivers-phy/gpy241) and [GPY241B0BC Data Sheet Rev. 1.7](https://www.maxlinear.com/Document/index?id=23386&languageid=1033&partnumber=GPY241&type=Data+Sheets), especially §§2.2.4.3, 3.5.1, 7.7.8, 7.8.4, and Literature References.
3. Microchip, [SparX-5 Family VSC7552/VSC7556/VSC7558 Data Sheet Rev. C](https://ww1.microchip.com/downloads/en/DeviceDoc/SparX-5_Family_L2L3_Enterprise_25G_Ethernet_Switches_Datasheet_00003823C.pdf), especially §§3.1.8, 4.3.5, 4.4, 7.1.5, and pin tables.
4. Microchip, [SparX-5/5i Hardware Design Checklist](https://ww1.microchip.com/downloads/en/DeviceDoc/SparX-5-5i-HW-Design-Checklist-00003911.pdf), especially §§4.1, 6.1–6.3.
5. Microchip, [VSC5641EV reference-design page](https://www.microchip.com/en-us/tools-resources/reference-designs/56-port-ethernet-switch-with-48x-1g-cu-4x-sfp28-and-4x-2-5g-cu-reference-design) and [VSC5641EV Hardware Manual](https://ww1.microchip.com/downloads/aemDocuments/documents/UNG/ProductDocuments/UserGuides/VSC5641EV-Hardware-Manual-DS50003593.pdf).
6. Keysight, [Signal Integrity Simulation Using ADS](https://www.keysight.com/us/en/assets/7018-05136/application-notes/5992-1379.pdf).
7. Keysight, [Explore the SerDes design space using the IBIS-AMI channel simulation flow](https://docs.keysight.com/download/attachments/592984474/Explore_the_SERDES_design_space_using_the_IBIS_AMI_channel_simulation_flow_v6.pdf?api=v2).
8. Keysight, [SIPro/PIPro technical overview](https://www.keysight.com/at/de/assets/7018-05074/data-sheets/5992-1291.pdf) and [ADS HSD/SIPro/PIPro bundle](https://www.keysight.com/zz/en/product/W3625B/pathwave-ads-core-em-design-layout-hsd-ckt-sim-sipro-pipro.html).
9. Linux kernel documentation, [10G-QXGMII PHY interface definition](https://linux.googlesource.com/linux/kernel/git/dhowells/linux-fs/+/refs/heads/afs-testing/Documentation/networking/phy.rst), useful as independent implementation nomenclature, but secondary to the device/interface specifications.
