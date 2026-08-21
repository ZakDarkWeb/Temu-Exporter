# Temu Order Exporter 3.1.0

Yeh Chrome extension Temu Seller Center ke `buy-shipping-bulk-details.html` page par active hoti hai. Version 3.1.0 mein bulk page open rehta hai aur extension background mein maximum **two order-detail tabs** process karti hai. Compact in-page card ab sirf extraction workflow, progress, retry, download aur order-export status par focus karta hai; History, Settings aur Diagnostics separate **History & Tools** page mein khulte hain. Har detail tab structured Temu data read karke record worker ko bhejti hai, phir deterministic cleanup ke through close ho jata hai. Worker restart ke baad orphan detail tabs bhi automatically close hote hain, isliye tabs accumulate nahi hone chahiye.

Agar Temu kisi order par `/no-auth.html`, login page, no-internet page, ya timeout show kare to extension us order ko turant lose nahi karti. Same order ko exponential backoff ke saath maximum three attempts tak retry kiya jata hai, aur har retry mein current Temu session identifier preserve hota hai. Retry ke baad bhi failure ho to batch next order par continue hota hai aur failed order workbook ke `Extraction Status` sheet mein record hota hai. Version 3.1.0 intentional tab closures ko retry errors nahi samajhti, every retry mein session preserve karti hai, legacy checkpoints ko normalized v3.1 state mein migrate karti hai, worker wake alarms use karti hai, aur legacy exporter detail tabs ko startup/new batch/Stop-Clear par clean karti hai. Retry-failed-only, branded TO icon set aur History & Tools features local-only hain; card mein sirf non-repetitive micro-interactions rakhi gayi hain, repetitive vibration/pulse animations disable hain, aur v3.1 ne extraction workflow ko header-aware row capture, duplicate suppression, strict detail validation, no-data guidance aur warning diagnostics ke saath harden kiya hai.

## Excel output

**Download Excel** button ek real `.xlsx` workbook banata hai, CSV nahi. Workbook mein `Orders` sheet par aapke requested columns, green header with bold white text, frozen header row, autofilter, Excel table, suitable column widths, aur numeric Qty/Revenue/Shipping Cost cells honge. `Shipping Date` ko original requested list ke mutabiq include kiya gaya hai; aapke screenshot mein visible table column B se start ho rahi thi, isliye screenshot mein `Shipping Date` crop ke bahar ho sakti hai. Agar ek order mein multiple products hon to har product ke liye separate row export hoti hai; Order No, customer, dates, tracking, Product Details aur Qty repeat hote hain. Screenshot ke highlighted pattern ke mutabiq top-right Sales proceeds ka total `Est. Revenue` aur package section ka bottom-left `Est. total shipping cost` sirf first product row mein likha jata hai; second/subsequent product rows mein dono money cells blank rehte hain taa-ke aap baad mein rows merge kar sakein.

| Column | Source |
| --- | --- |
| Shipping Date | Shipment confirmed at / structured package send time |
| Order Date | Purchase date / structured parent order time |
| Tracking Number | Package tracking number |
| Order No | Parent Order ID |
| Customer Name | Recipient name |
| Product Details | Base product title; trailing variation/spec groups such as `(2026)`, `(USA)`, `{Sleeve}`, and `(Special)` are removed. |
| Qty (No) | Order quantity |
| Est. Revenue | Top-right Sales proceeds total; populated only on the first product row of a multi-product order. |
| Shipping Cost | Bottom-left package `Est. total shipping cost`; populated only on the first product row of a multi-product order. |

Agar retry ya incomplete-field issue ho to `Extraction Status` sheet mein time, order number, package ID, attempts, aur error message mil jayega. Is se koi order silently disappear nahi hota. Dates ab sirf `Aug 21, 2026` format mein export hoti hain, aur quantity integer number format mein export hoti hai, isliye `1.00` ki jagah `1` nazar aayega.

## Branded extension icon

Extension card aur toolbar ke liye custom **TO** icon set add kiya gaya hai. White geometric `TO` monogram, cyan neon edge, dark navy glass-grid background aur upward export arrow current extension branding ke saath match karte hain. Chrome ke liye `icons/icon16.png`, `icon32.png`, `icon48.png`, aur `icon128.png` registered hain. Design details `ICON_DESIGN.md` mein documented hain.

## Compact in-page card

Chrome toolbar icon par click karne se unstable popup nahi khulta. Bulk-shipping page par existing compact card expand hota hai; kisi doosre Temu Seller Center page par extension bulk-shipping page open karti hai. Card mein **Start/Resume extraction**, progress, order/product-row counts, **Download Excel**, **Pause**, **Stop / clear**, aur **Retry failed** visible rehte hain. History, Settings aur Diagnostics card ko crowded nahi karte; header ka **Tools** button dedicated new tab mein History & Tools workspace kholta hai.

## Pipeline animation

In-page panel workflow ko teen stages mein show karta hai: **Capture rows → Read details → Build XLSX**. Running stage subtle cyan state ke saath active hoti hai, completed stage green state show karti hai, aur Motion Effects ya system reduced-motion preference animations ko disable kar sakti hai.

## History & Tools workspace

Card ke **Tools** button se new browser tab mein `tools.html` open hota hai. Is separate workspace mein recent sheets, individual Download/Delete actions, Clear all history, current-batch diagnostics, retry failed, current workbook download, Stop and clear, Open bulk page, aur local Motion/History settings available hain. Is separation se main extraction card compact aur focused rehta hai.

Sheet history last **20 extraction sessions** browser storage mein rakhti hai. Har session ke saath timestamp, order count, product-row count aur errors dikhte hain. **Download again** se purani workbook dobara ban jati hai; **Delete** individual history item remove karta hai; **Clear all history** poori local history clear karta hai. No data is uploaded.

## Installation

1. Pehle purani extension ko remove ya replace karein. ZIP extract karke `temu-order-exporter` folder rakhein.
2. Chrome mein `chrome://extensions` open karein.
3. **Developer mode** enable karein.
4. Purani Temu Order Exporter entry par **Remove** click karein, phir **Load unpacked** select karke naye extracted `temu-order-exporter` folder ko choose karein. Is folder ke andar `manifest.json` directly hona chahiye.
5. Temu Seller Center mein sign in rahein aur bulk-shipping detail page open karein.
6. Page reload karein. Right-bottom mein **Temu Order Exporter 3.1** compact panel nazar aayega. Agar bulk page `No data` dikhaye to pehle Manage Orders mein orders select karke **Buy shipping in bulk** workflow open karein. Chrome extension card ya toolbar mein naya icon na aaye to extension card par **Reload** click karein; Chrome kabhi kabhi purana icon cache rakhta hai.

## Use karne ka tareeqa

**Start extraction** click karne par extension current rendered table ki order rows capture karke background queue start karegi. Panel mein completed records, active tabs, retry count, aur errors dikhte rahenge. Beech mein rukna ho to **Pause** click karein. Pause ke baad **Resume** se wahi saved checkpoint continue hota hai. **Stop / clear** current batch, records, retry queue, aur checkpoint clear karta hai.

Process complete hone par **Download Excel** click karein. Maximum two detail tabs active hoti hain. Detail tab structured data available hote hi required fields validate karti hai; complete checkpoint aur confirmed tab close ke baad hi queue next order open karti hai. Batch complete hone se pehle bhi available product rows export kiye ja sakte hain. Agar Temu network/no-auth page dikhaye to extension ko manually reload karna zaroori nahi; retry queue automatically same order ko dobara attempt karegi. Background detail tabs success, error, timeout, stop, aur worker restart cases mein close kiye jate hain. Agar aakhir mein errors hon to `Extraction Status` sheet dekh kar sirf un orders ko manually re-run kiya ja sakta hai.

## Privacy and limitations

Order data kisi server par upload nahi hota. Structured data browser ke Temu page se local extension worker ko milta hai, checkpoint Chrome local storage mein save hota hai, aur workbook local browser download hoti hai. Extension sirf `https://seller.temu.com/*` pages ke liye configured hai. Temu agar future mein internal field names, URL behavior, ya page labels change kare to parser ko maintenance update ki zaroorat ho sakti hai.

## Verification

The upgraded package passed Manifest V3 and JavaScript syntax checks. The v3.1.0 compact panel and History & Tools page verified the dark neon status card, stable non-vibrating layout, polished toolbar/action buttons, compact responsive bounds, retry workflow, local history management, diagnostics, action-click navigation, and reduced-motion stylesheet. Captured signed-in Temu fixtures verified 29 bulk rows and the required detail values. Multi-product fixtures verified two separate product rows, base-title cleanup, repeated order/tracking fields, integer quantities, first-row-only total revenue, and first-row-only shipping cost. Mock worker tests verified strict two-tab concurrency, close-confirmed queue advancement, no-auth retry queueing, checkpointing, validation-before-close behavior, intentional close handling, service-worker wake-up handling, current and legacy orphan-tab recovery, and stop/clear behavior. The captured signed-in detail test verified that date-only values, cleaned title, quantity, revenue, shipping cost, and tracking are sent before tab closure. The actual XLSX generator produced a workbook that opened successfully with a standard Excel reader; headers, numeric cells, frozen panes, autofilter, green header styling, Excel table, and error sheet were all verified.


## v3.1 UI/UX refinement

Version 3.1.0 ne unstable popup completely remove kiya, in-page card ko compact kiya, repetitive vibration/pulse animations disable ki, aur secondary workflows ko dedicated History & Tools page mein move kiya. New-batch start aur retry flows stale warning logs/cache ko reset karte hain, history rows stored text ko safe DOM nodes se render karti hain, aur reduced-motion preferences all v3 transitions/animations par apply hoti hain.
