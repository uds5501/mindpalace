Coffee Journal Idea.
- I need the mindpalace to have a specific "coffee experiments" page.
- I want the coffee experiments page to have 2 separate sections.

1. the kind of coffees I've had.
   2. These should have name of coffee.
   3. The ways I've brewed the coffee (french press, pourover etc)
   4. tasting notes.
   5. A link to a page of recipes I've done with it.
6. I should be able to search the coffees based on brand / tasting notes / roast levels and sort them based on last brewed etc.

Build a responsive, modern Coffee Journal dashboard view for a personal engineering website using React and Tailwind CSS.

Visual Aesthetic & Theme:

Specialty coffee house meets clean technical documentation.

Canvas: #FBF9F5, Cards/Surface: #FFFFFF, Text: #1E1815 with secondary details in #665A53, Accent: #C25E2E, Borders: #EADFCF.

Key Sections & Features:

Header & Navigation: Back link to 'Technical Blog', page title ('Coffee Journal'), and a brief subtext noting origin count and total brews logged.

Filter & Search Bar:

Live search input (search by Brand, Origin, Varietal).

Filter chips for Roast Level (All, Light, Medium, Dark).

Quick toggles for Brew Method (Pour Over, Espresso, Aeropress, French Press).

Coffee Log Grid: Responsive 3-column card grid displaying:

Roaster/Brand name and country of origin flag/tag.

Coffee name and roast badge with distinct styling.

Tasting notes as minimal pill tags (e.g., 'Bergamot', 'Stone Fruit').

Key stats row: Brew method used, grind setting, ratio (e.g., 1:16).

A clear hyperlink button: 'View Recipe & Brew Notes →'.

Recipe Drawer / Modal Preview: Clicking a card or link opens a clean slide-over detailing water temp, total draw-down time, step-by-step pour intervals, and personal sensory review.

Make the layout scannable, lightweight, and accessible with semantic HTML.

---

## Coffees

### Amaltas Blend

| Field | Value |
|-------|-------|
| Name | Amaltas Blend |
| First brewed | 2026-09-25 |
| Methods tried | Pour over |
| Tasting notes | Solid body, not sour, balanced |

---

## Brew Log

### 2026-09-23 — Mellow Cocoffee (Pour Over)

| Parameter | Value |
|-----------|-------|
| Method | Pour over |
| Grinder | Timemore Chestnut C3s |
| Grind | 22 |
| Dose | 20 g |
| Water | 300 ml |
| Ratio | 1:15 |
| Brew time | 4:00 total |
| Finish | +300 ml coconut water (added after brew) |
| Total volume | ~600 ml |

**Tasting notes:** Nice mellow cocoffee — smooth, easy-drinking. Coconut water rounds off acidity and adds natural sweetness.

**Notes:** Longer drawdown (~4 min) on a medium-fine C3s setting; dilution with coconut water keeps the cup mellow rather than sharp.

### 2026-09-25 — Amaltas Blend (Pour Over)

| Parameter | Value |
|-----------|-------|
| Coffee | Amaltas Blend |
| Method | Pour over |
| Grinder | Timemore Chestnut C3s |
| Grind | 20 |
| Dose | 20 g |
| Water | 300 ml |
| Ratio | 1:15 |

**Tasting notes:** Really nice cup — solid body, wasn't sour. Clean and balanced.

**Notes:** First brew with this coffee. Grind 20 (vs 22 on prior pour over) landed well — finer setting may have helped body without tipping into sourness.