# Design-similarity review: Follow Me vs Polarsteps

Issue #205. Prepared 2026-10-02 as input to a lawyer's opinion. **This is an engineering review, not legal advice.**

## Scope and limits

- Compared against Polarsteps' **public website and marketing screenshots** (polarsteps.com, fetched 2026-10-02). I did not install or walk through the Polarsteps app, so in-app screens, the nav bar and the globe are judged from the marketing imagery only. Redo this with the real app before the lawyer call.
- I have not run a trademark search. Nothing here says a mark is or isn't registered.
- "Risk" below is my rough view of how closely we resemble them, not a prediction of how a court or the App Store would rule.

## Side-by-side

| Element | Polarsteps | Follow Me (before) | Risk | Action |
|---|---|---|---|---|
| **Name** | "Polarsteps" | "Follow Me" | Low vs Polarsteps. Separate risk: "Follow Me" is a generic phrase other products use | No Polarsteps reference anywhere user-facing. Lawyer to run a clearance search on "Follow Me" in classes 9/42/45 |
| **Logo / icon** | Circular glyph with a compass-needle mark, lowercase wordmark; coral-red rounded-square app icon with a white glyph | Navy camera silhouette with mountain peaks on pale blue | Low | None. Different concept, shape and colour |
| **Palette** | Warm cream background, coral-red CTA, dark green/charcoal text | Cool off-white (#F2F5F8), deep navy accent (#0E3A53), slate text | Low | None. Theme comment that said "single coral accent" was stale and is fixed |
| **Typography** | Rounded geometric sans with a handwritten accent font for section labels | System font | Low | None |
| **Bottom nav** | Floating white capsule, large icon over small caption, all tabs one navy colour, pale lozenge marks the selection, search button at the right end (*from our own earlier source notes — not verified against the real app; marketing shots don't show it*) | Floating frosted capsule, icon over caption, all tabs navy, pale lozenge marks the selection | **Medium** — the source comments openly said this was "shaped like" and "exactly as on the bar this copies" | **Changed.** Selected tab is now a solid navy chip with white icon and caption; unselected tabs are muted slate |
| **Route on map** | White dotted/dashed line over satellite imagery | White dashed line over satellite imagery | **Medium-low** — satellite plus route line is a common mapping convention, but our exact treatment matched | **Changed.** Solid amber line with a dark casing; no dashes |
| **Photo pins** | Circular photo bubbles with a white ring | Circular photo bubbles with a white ring | **Medium-low** | **Changed.** Rounded-square tiles with an amber frame |
| **Globe** | Flat satellite map in marketing shots (no globe seen) | 3D globe (MapLibre GL JS), glowing atmosphere ring on deep space | Low | None. The globe is more distinctive than their map |
| **Bottom sheet over map** | White rounded sheet sliding over the map | White rounded sheet over the globe | Low | None. Common mobile pattern; unchanged |
| **Core concept / copy** | "Plan, track, relive"; "Step-by-step updates"; travel books | Auto-posts photo batches to followers over WhatsApp | Low | None. Our copy avoids their taglines and "steps" vocabulary |
| **Source comments** | n/a | Comments in `theme.ts`, `SectionNav.tsx`, `styleUrl.ts` said "inspired by Polarsteps", "the Polarsteps bar", "the Polarsteps-like look" | **High as evidence**, nil as design | **Removed.** `src/brandGuard.test.ts` fails the build if the name returns to `src/` |

## What changed in code

- `src/ui/navigation/SectionNav.tsx`, `src/ui/theme/theme.ts` — selection model and comments (see table). The now-unused `navPill` token is gone.
- `src/ui/map/routeStyle.ts` (new), `src/ui/map/globeHtml.ts` — route and pin styling read from one place.
- `src/ui/map/styleUrl.ts` — comment only.
- `src/brandGuard.test.ts`, `src/ui/map/globeHtml.test.ts` — tests for the above.

Git history still contains the old comments. Rewriting history isn't proportionate; tell the lawyer it exists.

## Still open (needs a human)

1. **IP lawyer opinion** — the issue's third to-do. Suggested brief: this document, screenshots of both apps side by side, and the questions below. I can't do this part.
2. **Walk through the real Polarsteps app** and re-check the nav, the profile/trip screens and the map with it open next to ours.
3. **Clearance search for "Follow Me"** (USPTO and EUIPO, plus the App Store) and a decision on a more distinctive name or a logotype if the search is crowded. This is the highest-value item for the name, and it has nothing to do with Polarsteps.
4. **Third-party assets** — confirm the logo artwork (`assets/logo.png`, `assets/icon.png`) is original or properly licensed, and that the MapTiler satellite/attribution terms are met in the globe view.

### Questions for the lawyer

- Is the remaining overlap (satellite map plus route line plus photo pins, floating tab capsule, sheet over map) the kind of functional/common design that trade dress doesn't protect?
- Does having once written "inspired by / copies" in source comments, now removed from the tree but present in git history, change the exposure?
- Is "Follow Me" registrable and clear for a social/photo-sharing app in our launch markets?

## Residual view

After the changes, I'd rate the overall resemblance as **low**. What's left is mostly the shared conventions of the travel-tracker category (a map with a route, photos at stops, a bottom tab bar). The two items that could still matter are the "Follow Me" name clearance and the lawyer's read of the original nav bar's history.
