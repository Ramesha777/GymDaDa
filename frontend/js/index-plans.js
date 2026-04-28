/**
 * Renders the membership plan cards inside the homepage `#plans` section.
 * Reuses the same rendering helper as the dedicated membership page.
 */
import { renderPlanCards, setupBillingToggle } from './plan-render.js';

var grid = document.getElementById('plansGrid');
var billingBtns = document.querySelectorAll('#plans .ms-billing-btn');

var period = 'monthly';

setupBillingToggle(billingBtns, function(p) {
    period = p;
    renderPlanCards(grid, period);
}, period);

renderPlanCards(grid, period);
