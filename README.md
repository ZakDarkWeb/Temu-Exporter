# Temu Order Exporter 2.8.0

Yeh Chrome extension Temu Seller Center ke `buy-shipping-bulk-details.html` page par active hoti hai. Version 2.8.0 mein bulk page open rehta hai aur extension background mein maximum **two order-detail tabs** process karti hai. Panel ab ZHunter PRO-inspired dark navy/cyan neon branding, glass-grid card styling, collapsible floating mode, toolbar icons, Settings drawer, local sheet history, Download again, Delete, aur reduced-motion support ke saath aata hai. Har detail tab structured Temu data read karke record worker ko bhejti hai, phir deterministic cleanup ke through close ho jata hai. Worker restart ke baad orphan detail tabs bhi automatically close hote hain, isliye tabs accumulate nahi hone chahiye.

Agar Temu kisi order par `/no-auth.html`, login page, no-internet page, ya timeout show kare to extension us order ko turant lose nahi karti. Same order ko exponential backoff ke saath maximum three attempts tak retry kiya jata hai, aur har retry mein current Temu session identifier preserve hota hai. Retry ke baad bhi failure ho to batch next order par continue hota hai aur failed order workbook ke `Extraction Status` sheet mein record hota hai. Version 2.8.0 intentional tab closures ko retry errors nahi samajhti, every retry mein session preserve karti hai, purana v6 checkpoint reuse nahi karti, aur legacy exporter detail tabs ko startup/new batch/Stop-Clear par clean karti hai. Premium UI, Popup Command Center, retry-failed-only aur history features local-only hain; smooth transitions, hover/active micro-interactions, polished buttons, pipeline animation aur accessibility states lightweight CSS par based hain; extraction behavior ya accuracy workflow change nahi hua.

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

## Popup Command Center

Chrome toolbar se extension icon click karne par compact **Popup Command Center** open hota hai. Popup current page detect karke status, progress, orders, product rows, active tabs aur errors show karta hai. Yahin se **Start extraction**, **Resume extraction**, **Pause**, **Download**, **Stop / clear**, **Open bulk page**, aur **Retry failed** actions available hain. Popup recent saved sheets ka short list bhi show karta hai; individual Download action se historical workbook dobara generate hoti hai. Popup in-page panel ko replace nahi karta: detailed activity log aur Settings/History drawers in-page card mein available rehte hain.

## Pipeline animation

In-page panel aur popup ab workflow ko teen stages mein show karte hain: **Capture rows → Read details → Build XLSX**. Running stage subtle cyan pulse ke saath active hoti hai, completed stage green state show karti hai, aur Motion Effects ya system reduced-motion preference animations ko disable kar sakti hai.

## Premium panel controls

Top-right toolbar se **Sheet history**, **Settings**, aur **Minimize** access hote hain. Minimize karne par panel branded floating `TO` button ban jata hai; us par click karke panel expand kiya ja sakta hai, aur state reload ke baad bhi remember hoti hai. Settings mein local history aur motion effects independently enable/disable kiye ja sakte hain.

Sheet history last **20 extraction sessions** browser storage mein rakhti hai. Har session ke saath timestamp, order count, product-row count aur errors dikhte hain. **Download again** se purani workbook dobara ban jati hai; **Delete** individual history item remove karta hai; **Clear all history** poori local history clear karta hai. No data is uploaded.

## Installation

1. Pehle purani extension ko remove ya replace karein. ZIP extract karke `temu-order-exporter` folder rakhein.
2. Chrome mein `chrome://extensions` open karein.
3. **Developer mode** enable karein.
4. Purani Temu Order Exporter entry par **Remove** click karein, phir **Load unpacked** select karke naye extracted `temu-order-exporter` folder ko choose karein. Is folder ke andar `manifest.json` directly hona chahiye.
5. Temu Seller Center mein sign in rahein aur bulk-shipping detail page open karein.
6. Page reload karein. Right-bottom mein **Temu Order Exporter 2.8** panel nazar aayega.

## Use karne ka tareeqa

**Start extraction** click karne par extension current rendered table ki order rows capture karke background queue start karegi. Panel mein completed records, active tabs, retry count, aur errors dikhte rahenge. Beech mein rukna ho to **Pause** click karein. Pause ke baad **Resume** se wahi saved checkpoint continue hota hai. **Stop / clear** current batch, records, retry queue, aur checkpoint clear karta hai.

Process complete hone par **Download Excel** click karein. Maximum two detail tabs active hoti hain. Detail tab structured data available hote hi required fields validate karti hai; complete checkpoint aur confirmed tab close ke baad hi queue next order open karti hai. Batch complete hone se pehle bhi available product rows export kiye ja sakte hain. Agar Temu network/no-auth page dikhaye to extension ko manually reload karna zaroori nahi; retry queue automatically same order ko dobara attempt karegi. Background detail tabs success, error, timeout, stop, aur worker restart cases mein close kiye jate hain. Agar aakhir mein errors hon to `Extraction Status` sheet dekh kar sirf un orders ko manually re-run kiya ja sakta hai.

## Privacy and limitations

Order data kisi server par upload nahi hota. Structured data browser ke Temu page se local extension worker ko milta hai, checkpoint Chrome local storage mein save hota hai, aur workbook local browser download hoti hai. Extension sirf `https://seller.temu.com/*` pages ke liye configured hai. Temu agar future mein internal field names, URL behavior, ya page labels change kare to parser ko maintenance update ki zaroorat ho sakti hai.

## Verification

The upgraded package passed Manifest V3 and JavaScript syntax checks. The v2.8.0 panel and popup previews verified the dark neon status card, refined progress and pipeline animations, polished toolbar/action buttons, hover and active micro-interactions, collapsible state, Settings drawer, Sheet history drawer, Popup Command Center, Retry failed workflow, responsive layout, local-storage hooks, and reduced-motion stylesheet. Captured signed-in Temu fixtures verified 29 bulk rows and the required detail values. Multi-product fixtures verified two separate product rows, base-title cleanup, repeated order/tracking fields, integer quantities, first-row-only total revenue, and first-row-only shipping cost. Mock worker tests verified strict two-tab concurrency, close-confirmed queue advancement, no-auth retry queueing, checkpointing, validation-before-close behavior, intentional close handling, service-worker wake-up handling, current and legacy orphan-tab recovery, and stop/clear behavior. The captured signed-in detail test verified that date-only values, cleaned title, quantity, revenue, shipping cost, and tracking are sent before tab closure. The actual XLSX generator produced a workbook that opened successfully with a standard Excel reader; headers, numeric cells, frozen panes, autofilter, green header styling, Excel table, and error sheet were all verified.
