# Interface design

The interface keeps the order, modifications and total visible, with the next action beside them. It uses Next.js, Tailwind 3.4 and semantic HTML controls.

## Reference and tokens

The [generated desktop concept](evidence/design-concept.png), 1536 × 1024, guided the layout. The customer UI renders HTML and React components; the concept image is retained as a reference.

- Paper `#f7f4eb`, ink `#242b26`, orange action `#b94d21`, muted olive voice `#536851`.
- Georgia headings and restaurant wordmark; Arial/Helvetica controls and body text.
- Two columns for the order and next action, thin dividers, quantity markers and 9–12 px corners on controls and dialogs.
- Orange actions and brown modifier text on a plain background.
- A single column on mobile. Crew and kitchen layouts support 390 px widths, keyboard focus, native dialogs, labels and reduced motion.

## Layout review

The initial browser review covered login → example order → correction → quote → confirmation → kitchen. Playwright then automated the flow and saved screenshots for comparison with the concept. This table records that review, rather than a fresh check of every later change.

| Point inspected                    | Result / repair                                                                                                                                                                                           |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Header and footer                  | Harbor Burger heads the page; the footer identifies SayGo, the independent simulator and payment at the window.                                                                                           |
| Order and action columns           | Order list on the left, next action on the right.                                                                                                                                                         |
| Typography                         | Serif product names/headings and sans-serif controls. Long product names wrap on mobile.                                                                                                                  |
| Palette                            | Paper, charcoal, orange and olive tokens match the reference.                                                                                                                                             |
| Quantity, modifications and prices | Stable rows, right-aligned prices and separate subtotal/tax/total. Rows follow the cart's actual order, which can differ from the illustration.                                                           |
| Button borders and edit targets    | Removed an unintended Tailwind `outline` utility border; enlarged edit targets and moved them to the row's right side, reducing excess row height.                                                        |
| Controls and status                | Added Edit controls, fixture and speech disclosures, captions, quote expiry and a disabled voice control when unconfigured.                                                                               |
| Development chrome                 | Disabled the Next dev indicator, which covered content in the first screenshots. Compile/runtime errors remain surfaced by Next.                                                                          |
| Review-state copy and capture      | Invalidated/expired reviews now ask for a fresh review instead of retaining stale confirmation prose. Reduced-motion screenshots and an opacity assertion capture the ready confirm control consistently. |
| Responsive behavior                | 1536×1024 desktop, 1024×768 tablet landscape, and 390×844 crew/kitchen checked. No horizontal overflow in automated checks.                                                                               |
| Assets and motion                  | The board uses text and controls without image assets. Reduced motion removes transitions.                                                                                                                |

The rendered board adds order-update messages, exact quote review, staff takeover, uncertain acceptance, Edit controls and fixture/voice status. The three-line example and $18.09 total stay prominent. Disclosures can make the page taller than the concept; the reviewed screenshots showed no clipped primary content.

## Saved evidence

- [Order board](evidence/order-board.png)
- [Review](evidence/review.png)
- [Staff takeover](evidence/staff-takeover.png)
- [Kitchen](evidence/kitchen.png)
- [Tablet order board](evidence/order-tablet.png)
- [Mobile crew](evidence/crew-mobile.png)
- [Mobile kitchen](evidence/kitchen-mobile.png)

These screenshots document the initial visual review. Accessibility certification and pixel-for-pixel matching were outside its scope.

## Generation prompt

The original image-generation prompt is preserved below for provenance.

Use case: ui-mockup. Create a complete high-fidelity desktop browser app screen for Harbor Burger drive-through order board, software SayGo. 1536x1024 landscape design reference. Restaurant-first, highly readable warm cream #f7f4eb, charcoal #242b26, orange #be481e, quiet olive #56715e. Original restaurant type-only brand header Harbor Burger left, Lane 01 right and small Ask staff outlined button. No food photos, illustrations or gradients. Main 2/3 left open order board, right 1/3 cream rail, thin rules instead of card grids. Large serif heading Your order, small helper Make it just right. Three generously spaced native HTML-like order rows with square quantity marker 1, product name, modifier text and right-aligned price: Harbor Cheeseburger / No onions · No cheese / $6.50; Harbor Cheeseburger / Standard / $6.50; Lemonade / Large / $3.75. Total footer Subtotal $16.75; Demo tax (8%) $1.34; Total $18.09. Right rail heading Looking good? and concise prompt You can make a change, or review your order. Dark rounded 10px primary button Review order. Secondary Browse menu button. Lower panel No-key fixture mode, sample scenario buttons Start example order, Apply correction; small Start live voice button. Clear muted text AI-generated speech when enabled. Bottom footer SayGo / Independent Alexa+ concept simulator / Payment due at window. Sophisticated typography, editorial serif headings, clean system sans chrome, max legibility, large touch targets. Code-native UI text and controls, no fake charts, no marketing, no chat bubbles, no eyebrows or decorative pills. Include complete screen footer and necessary states implied by visible flow; no unrelated features.
