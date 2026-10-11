# Design reference and browser fidelity ledger

The frontend-design and frontend-app-builder skills guided a restaurant-first board rather than a chat transcript. The build uses the user-requested Next.js and Tailwind 3.4 stack. All order rows, menu choices, totals, forms and controls are semantic HTML/React—not the reference image rendered as an interface.

## Reference and tokens

Reference: [generated desktop concept](evidence/design-concept.png), 1536 × 1024. Generated with the built-in image tool, then saved into this repository. It is a design reference only; no generated bitmap ships in the customer UI.

- Paper `#f7f4eb`, ink `#242b26`, orange action `#b94d21`, muted olive voice `#536851`.
- Georgia editorial headings/restaurant wordmark; Arial/Helvetica UI text with explicit sizes.
- Open two-column board/rail, thin dividers, individual quantity squares, 9–12 px control/dialog corners.
- One warm accent for actions; modifiers get restrained brown emphasis. No photos, chat bubbles, sales metrics, gradients or decorative illustrations.
- One-column mobile continuation; crew and kitchen stay readable at 390 px. Keyboard focus, native dialogs, labels and reduced-motion handling are implemented.

## Comparison ledger

Reference and rendered screenshots were opened directly with the image viewer in the same inspection pass. IAB was used first for login → example → correction → quote → confirmation → kitchen. The requested Playwright suite then automated that path and captured repeatable screenshots, rather than substituting for initial IAB verification.

| Point inspected                                   | Result / repair                                                                                                                                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Restaurant-first header and small software footer | Harbor Burger stays dominant; SayGo and independent-simulator/payment boundaries remain in the footer.                                                                                                             |
| Board/rail hierarchy                              | Open order list on the left and single next-step rail on the right match the reference. No extra marketing dashboard.                                                                                              |
| Type hierarchy                                    | Serif product/heading emphasis and sans-serif control hierarchy are retained. Actual long product names wrap naturally on mobile.                                                                                  |
| Warm paper/charcoal/accent palette                | Tokens are locked; no photography or gradient substitution.                                                                                                                                                        |
| Quantity, modifications and prices                | Individual stable rows, right-aligned prices, separate subtotal/tax/total. Canonical fixture order places the standard burger first; unlike the concept illustration, display order follows actual cart order.     |
| Button borders and edit targets                   | Removed an unintended Tailwind `outline` utility border; enlarged edit targets and moved them to the row's right side, reducing excess row height.                                                                 |
| Native controls / honest operational states       | Added necessary Edit controls, fixture disclosures, captions/operator disclosures, quote expiry and disabled unconfigured voice. These intentional functional additions were absent or abbreviated in the concept. |
| Development chrome                                | Disabled the Next dev indicator, which covered content in the first screenshots. Compile/runtime errors remain surfaced by Next.                                                                                   |
| Review-state copy and capture                     | Invalidated/expired reviews now ask for a fresh review instead of retaining stale confirmation prose. Reduced-motion screenshots and an opacity assertion capture the ready confirm control consistently.          |
| Responsive behavior                               | 1536×1024 desktop, 1024×768 tablet landscape, and 390×844 crew/kitchen checked. No horizontal overflow in automated checks.                                                                                        |
| Assets and motion                                 | No UI images to fail loading. No animated waveform that could imply a live microphone. Reduced motion removes transitions.                                                                                         |

Above-the-fold copy was compared against the reference and the brief. Intentional differences are operational, not new product claims: dynamic “Updated your order,” exact quote review, staff takeover/unknown acceptance, touch Edit, and explicit no-key/live-disabled labels. The disabled voice control does not imitate a functioning live session. The original three lines and $18.09 total remain prominent. Additional disclosure controls can extend the page beyond the concept's exact height; no primary content is clipped.

## Saved evidence

- [Order board](evidence/order-board.png)
- [Review](evidence/review.png)
- [Staff takeover](evidence/staff-takeover.png)
- [Kitchen](evidence/kitchen.png)
- [Tablet order board](evidence/order-tablet.png)
- [Mobile crew](evidence/crew-mobile.png)
- [Mobile kitchen](evidence/kitchen-mobile.png)

The implementation was visually checked against the concept's hierarchy, typography, palette, spacing, controls and container treatment, with the functional deviations above. This is not a claim of pixel identity or external accessibility certification.

## Generation prompt

Use case: ui-mockup. Create a complete high-fidelity desktop browser app screen for Harbor Burger drive-through order board, software SayGo. 1536x1024 landscape design reference. Restaurant-first, highly readable warm cream #f7f4eb, charcoal #242b26, orange #be481e, quiet olive #56715e. Original restaurant type-only brand header Harbor Burger left, Lane 01 right and small Ask staff outlined button. No food photos, illustrations or gradients. Main 2/3 left open order board, right 1/3 cream rail, thin rules instead of card grids. Large serif heading Your order, small helper Make it just right. Three generously spaced native HTML-like order rows with square quantity marker 1, product name, modifier text and right-aligned price: Harbor Cheeseburger / No onions · No cheese / $6.50; Harbor Cheeseburger / Standard / $6.50; Lemonade / Large / $3.75. Total footer Subtotal $16.75; Demo tax (8%) $1.34; Total $18.09. Right rail heading Looking good? and concise prompt You can make a change, or review your order. Dark rounded 10px primary button Review order. Secondary Browse menu button. Lower panel No-key fixture mode, sample scenario buttons Start example order, Apply correction; small Start live voice button. Clear muted text AI-generated speech when enabled. Bottom footer SayGo / Independent Alexa+ concept simulator / Payment due at window. Sophisticated typography, editorial serif headings, clean system sans chrome, max legibility, large touch targets. Code-native UI text and controls, no fake charts, no marketing, no chat bubbles, no eyebrows or decorative pills. Include complete screen footer and necessary states implied by visible flow; no unrelated features.
