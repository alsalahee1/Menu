/* Bilingual UI (English / Arabic) with right-to-left support.
 *
 * Loaded before every page script. It sets <html lang> and <html dir> as early
 * as possible so the first paint is already in the right direction, and exposes
 * t() for UI strings plus localised() for restaurant-authored content.
 */
/* eslint-env browser */
(function () {
  'use strict';

  const LANGS = {
    en: { name: 'English', native: 'English', dir: 'ltr', locale: 'en' },
    // Latin digits are kept for Arabic ('-u-nu-latn'): prices, order codes and
    // table numbers are read and spoken in Latin numerals across most of the
    // Gulf and Levant, and mixing numeral systems in a receipt invites errors.
    ar: { name: 'Arabic', native: 'العربية', dir: 'rtl', locale: 'ar-u-nu-latn' },
  };

  const STORAGE_KEY = 'menu.lang';

  const STRINGS = {
    // ---- shared ---------------------------------------------------------
    'app.name': ['Menu', 'مِنيو'],
    'common.save': ['Save', 'حفظ'],
    'common.saveChanges': ['Save changes', 'حفظ التغييرات'],
    'common.cancel': ['Cancel', 'إلغاء'],
    'common.close': ['Close', 'إغلاق'],
    'common.delete': ['Delete', 'حذف'],
    'common.edit': ['Edit', 'تعديل'],
    'common.add': ['Add', 'إضافة'],
    'common.done': ['Done', 'تم'],
    'common.confirm': ['Confirm', 'تأكيد'],
    'common.refresh': ['Refresh', 'تحديث'],
    'common.search': ['Search', 'بحث'],
    'common.details': ['Details', 'التفاصيل'],
    'common.status': ['Status', 'الحالة'],
    'common.name': ['Name', 'الاسم'],
    'common.email': ['Email', 'البريد الإلكتروني'],
    'common.phone': ['Phone', 'الهاتف'],
    'common.password': ['Password', 'كلمة المرور'],
    'common.role': ['Role', 'الدور'],
    'common.total': ['Total', 'الإجمالي'],
    'common.subtotal': ['Subtotal', 'المجموع الفرعي'],
    'common.tax': ['Tax', 'الضريبة'],
    'common.serviceCharge': ['Service charge', 'رسوم الخدمة'],
    'common.discount': ['Discount', 'الخصم'],
    'common.price': ['Price', 'السعر'],
    'common.qty': ['Qty', 'الكمية'],
    'common.item': ['Item', 'الصنف'],
    'common.items': ['items', 'أصناف'],
    'common.note': ['Note', 'ملاحظة'],
    'common.table': ['Table', 'الطاولة'],
    'common.takeaway': ['Takeaway', 'سفري'],
    'common.dineIn': ['Dine in', 'في المطعم'],
    'common.orders': ['Orders', 'الطلبات'],
    'common.revenue': ['Revenue', 'الإيرادات'],
    'common.all': ['All', 'الكل'],
    'common.none': ['None', 'لا شيء'],
    'common.never': ['Never', 'أبداً'],
    'common.optional': ['optional', 'اختياري'],
    'common.required': ['Required', 'مطلوب'],
    'common.loading': ['Loading…', 'جارٍ التحميل…'],
    'common.signOut': ['Sign out', 'تسجيل الخروج'],
    'common.signIn': ['Sign in', 'تسجيل الدخول'],
    'common.back': ['Back', 'رجوع'],
    'common.print': ['Print', 'طباعة'],
    'common.copy': ['Copy', 'نسخ'],
    'common.copied': ['Copied to clipboard', 'تم النسخ'],
    'common.paid': ['Paid', 'مدفوع'],
    'common.unpaid': ['Unpaid', 'غير مدفوع'],
    'common.refunded': ['Refunded', 'مسترد'],
    'common.somethingWrong': ['Something went wrong', 'حدث خطأ ما'],
    'common.from': ['From', 'من'],
    'common.to': ['To', 'إلى'],
    'common.sold': ['sold', 'مُباع'],
    'common.free': ['Free', 'مجاني'],
    'common.language': ['Language', 'اللغة'],

    // ---- order statuses -------------------------------------------------
    'status.pending': ['Awaiting confirmation', 'بانتظار التأكيد'],
    'status.accepted': ['Confirmed', 'تم التأكيد'],
    'status.preparing': ['Being prepared', 'قيد التحضير'],
    'status.ready': ['Ready to serve', 'جاهز للتقديم'],
    'status.served': ['Served', 'تم التقديم'],
    'status.completed': ['Completed', 'مكتمل'],
    'status.cancelled': ['Cancelled', 'ملغي'],

    // ---- landing --------------------------------------------------------
    'landing.tagline': ['No app · No waiting', 'بدون تطبيق · بدون انتظار'],
    'landing.title': ['Scan the code on your table. Order in seconds.', 'امسح الرمز على طاولتك واطلب في ثوانٍ.'],
    'landing.lede': [
      'Guests scan a QR code, browse the live menu, and send their order straight to the kitchen. Staff track every ticket on one screen — no paper, no shouting across the pass.',
      'يمسح الضيوف رمز الاستجابة السريعة، ويتصفحون القائمة، ويرسلون طلبهم مباشرة إلى المطبخ. ويتابع الموظفون كل طلب على شاشة واحدة — بلا ورق ولا مناداة.',
    ],
    'landing.tryTable': ['Try a live table', 'جرّب طاولة حقيقية'],
    'landing.staffSignIn': ['Staff sign in', 'دخول الموظفين'],
    'landing.demoNote': ['Demo accounts are listed at the bottom of this page.', 'حسابات التجربة مذكورة في أسفل الصفحة.'],
    'landing.scanHint': ['Point your phone camera at this code, or tap the button below.', 'وجّه كاميرا هاتفك إلى هذا الرمز، أو اضغط الزر أدناه.'],
    'landing.openTable': ['Open this table', 'افتح هذه الطاولة'],
    'landing.howItWorks': ['How it works', 'كيف يعمل'],
    'landing.step1': ['Scan', 'امسح'],
    'landing.step1Body': ["Every table has its own QR code. Scanning opens that table's menu — no typing, no app install.", 'لكل طاولة رمزها الخاص. المسح يفتح قائمة تلك الطاولة — بلا كتابة وبلا تثبيت تطبيق.'],
    'landing.step2': ['Order', 'اطلب'],
    'landing.step2Body': ['Browse by category, pick sizes and extras, add a note for the kitchen, then send.', 'تصفح حسب الفئة، اختر الأحجام والإضافات، أضف ملاحظة للمطبخ، ثم أرسل.'],
    'landing.step3': ['Kitchen', 'المطبخ'],
    'landing.step3Body': ['The ticket appears instantly on the kitchen display, colour-coded by how long it has been waiting.', 'يظهر الطلب فوراً على شاشة المطبخ، ملوّناً حسب مدة انتظاره.'],
    'landing.step4': ['Served', 'التقديم'],
    'landing.step4Body': ['Guests watch the status live, call a waiter, or ask for the bill with one tap.', 'يتابع الضيوف الحالة مباشرة، وينادون النادل، أو يطلبون الفاتورة بضغطة واحدة.'],
    'landing.demoRestaurants': ['Live demo restaurants', 'مطاعم تجريبية'],
    'landing.demoRestaurantsBody': ['Open a table exactly the way a guest would after scanning.', 'افتح طاولة تماماً كما يفعل الضيف بعد المسح.'],
    'landing.openATable': ['Open a table', 'افتح طاولة'],
    'landing.menu': ['Menu', 'القائمة'],
    'landing.dishes': ['dishes', 'أطباق'],
    'landing.builtFor': ['Built for the whole restaurant', 'مصمم لكل من في المطعم'],
    'landing.demoAccounts': ['Demo sign-in accounts', 'حسابات الدخول التجريبية'],
    'landing.interested': ['Interested in this for your restaurant?', 'مهتم بهذا النظام لمطعمك؟'],
    'landing.interestedBody': ['Leave your details and we will get in touch.', 'اترك بياناتك وسنتواصل معك.'],
    'landing.yourName': ['Your name', 'اسمك'],
    'landing.restaurant': ['Restaurant', 'المطعم'],
    'landing.requestCallback': ['Request a callback', 'اطلب تواصلاً'],
    'landing.leadThanks': ['Thanks — we will be in touch shortly.', 'شكراً لك — سنتواصل معك قريباً.'],
    'landing.myOrders': ['My orders', 'طلباتي'],
    'landing.platformAdmin': ['Platform admin', 'إدارة المنصة'],
    'landing.noDemo': ['No demo restaurants yet. Run "npm run seed" to create them.', 'لا توجد مطاعم تجريبية بعد. شغّل "npm run seed" لإنشائها.'],

    // ---- guest menu -----------------------------------------------------
    'menu.help': ['Help', 'مساعدة'],
    'menu.viewCart': ['View cart', 'عرض السلة'],
    'menu.popular': ['Popular right now', 'الأكثر طلباً الآن'],
    'menu.soldOut': ['Sold out', 'نفد'],
    'menu.inCart': ['in cart', 'في السلة'],
    'menu.browsingOnly': ['Browsing the menu — scan a table code to order', 'تصفح القائمة — امسح رمز الطاولة للطلب'],
    'menu.previewNotice': ['You are previewing the menu. Scan the QR code on your table to place an order.', 'أنت تتصفح القائمة فقط. امسح رمز طاولتك لإرسال طلب.'],
    'menu.pausedNotice': ['This restaurant has paused online ordering. You can browse the menu, but orders cannot be sent right now.', 'أوقف المطعم الطلب الإلكتروني مؤقتاً. يمكنك التصفح، لكن لا يمكن إرسال الطلبات الآن.'],
    'menu.needSomething': ['Need something?', 'تحتاج شيئاً؟'],
    'menu.callWaiter': ['Call a waiter', 'نادِ النادل'],
    'menu.askWater': ['Ask for water', 'اطلب ماء'],
    'menu.water': ['Water', 'ماء'],
    'menu.requestBill': ['Request the bill', 'اطلب الفاتورة'],
    'menu.clearTable': ['Clear the table', 'تنظيف الطاولة'],
    'menu.staffNotified': ['A member of staff has been notified.', 'تم إبلاغ أحد الموظفين.'],
    'menu.serviceAfterScan': ['Available once you scan a table code.', 'متاح بعد مسح رمز الطاولة.'],
    'menu.previousOrders': ['My previous orders', 'طلباتي السابقة'],
    'menu.unavailable': ['Menu unavailable', 'القائمة غير متاحة'],
    'menu.backHome': ['Back to home', 'العودة للرئيسية'],
    'menu.noteForKitchen': ['Note for the kitchen', 'ملاحظة للمطبخ'],
    'menu.notePlaceholder': ['e.g. no onions, extra napkins', 'مثال: بدون بصل، مناديل إضافية'],
    'menu.chooseAtLeast': ['Please choose {n} from "{group}"', 'يرجى اختيار {n} من "{group}"'],
    'menu.chooseAtMost': ['You can pick at most {n} from "{group}"', 'يمكنك اختيار {n} كحد أقصى من "{group}"'],
    'menu.requiredChoose': ['Required · choose {range}', 'مطلوب · اختر {range}'],
    'menu.optionalUpTo': ['Optional · up to {n}', 'اختياري · حتى {n}'],
    'menu.addedToOrder': ['{name} added to your order', 'تمت إضافة {name} إلى طلبك'],
    'menu.itemsRemoved': ['Some items in your cart are no longer available and were removed.', 'بعض الأصناف في سلتك لم تعد متاحة وتمت إزالتها.'],
    'menu.yourOrder': ['Your order', 'طلبك'],
    'menu.tableCode': ['Table code {code}', 'رمز الطاولة {code}'],
    'menu.emptyCart': ['Empty', 'إفراغ'],
    'menu.emptyCartTitle': ['Empty your cart?', 'إفراغ السلة؟'],
    'menu.emptyCartBody': ['This removes everything you have added.', 'سيؤدي هذا إلى إزالة كل ما أضفته.'],
    'menu.sendToKitchen': ['Send to kitchen', 'أرسل للمطبخ'],
    'menu.scanToOrder': ['Scan a table to order', 'امسح طاولة للطلب'],
    'menu.sending': ['Sending…', 'جارٍ الإرسال…'],
    'menu.noteWholeOrder': ['Note for the whole order', 'ملاحظة على الطلب كامل'],
    'menu.notePlaceholder2': ['Allergies, timing, anything else', 'الحساسية، التوقيت، أو أي شيء آخر'],
    'menu.guestName': ['Your name (optional)', 'اسمك (اختياري)'],
    'menu.guestPhone': ['Phone (optional)', 'الهاتف (اختياري)'],
    'menu.howOrderingWorks': ['How ordering works', 'كيف يتم الطلب'],
    'menu.help1': ['Tap a dish to choose size, extras and quantity.', 'اضغط على أي طبق لاختيار الحجم والإضافات والكمية.'],
    'menu.help2': ['Review everything in your cart, then send it to the kitchen.', 'راجع سلتك ثم أرسلها إلى المطبخ.'],
    'menu.help3': ['Watch the live status — you will see when it is being prepared and when it is on its way.', 'تابع الحالة مباشرة — سترى متى يُحضَّر ومتى يكون في الطريق.'],
    'menu.help4': ['Need a person? Use the "Call a waiter" or "Request the bill" buttons.', 'تحتاج شخصاً؟ استخدم زر "نادِ النادل" أو "اطلب الفاتورة".'],
    'menu.helpTable': ['You are ordering for table code {code}. Your food is brought to this table.', 'أنت تطلب لرمز الطاولة {code}. سيُقدَّم طعامك إلى هذه الطاولة.'],
    'menu.helpNoTable': ['Scan the QR code on your table to start ordering.', 'امسح رمز طاولتك لبدء الطلب.'],
    'menu.callRestaurant': ['Call the restaurant: {phone}', 'اتصل بالمطعم: {phone}'],
    'menu.gotIt': ['Got it', 'فهمت'],
    'menu.orderMore': ['Order more', 'اطلب المزيد'],
    'menu.kcal': ['{n} kcal', '{n} سعرة'],
    'menu.minutes': ['{n} min', '{n} دقيقة'],

    // ---- order tracking -------------------------------------------------
    'order.title': ['Order {code}', 'طلب {code}'],
    'order.yourOrder': ['Your order', 'طلبك'],
    'order.live': ['Live', 'مباشر'],
    'order.notFound': ['Order not found', 'الطلب غير موجود'],
    'order.progress': ['Progress', 'التقدم'],
    'order.history': ['History', 'السجل'],
    'order.receipt': ['Receipt', 'الفاتورة'],
    'order.placedAt': ['Placed {time}', 'تم الطلب {time}'],
    'order.orderNote': ['Order note: {note}', 'ملاحظة الطلب: {note}'],
    'order.estimated': ['Estimated {n} min', 'الوقت المتوقع {n} دقيقة'],
    'order.step.pending': ['Order received', 'تم استلام الطلب'],
    'order.step.pendingHint': ['Waiting for the restaurant to confirm', 'بانتظار تأكيد المطعم'],
    'order.step.accepted': ['Confirmed', 'تم التأكيد'],
    'order.step.acceptedHint': ['The restaurant has your order', 'المطعم استلم طلبك'],
    'order.step.preparing': ['Being prepared', 'قيد التحضير'],
    'order.step.preparingHint': ['The kitchen is cooking', 'المطبخ يُحضِّر طلبك'],
    'order.step.ready': ['Ready', 'جاهز'],
    'order.step.readyHint': ['Your food is plated and on its way', 'طعامك جاهز وفي الطريق إليك'],
    'order.step.served': ['Served', 'تم التقديم'],
    'order.step.servedHint': ['Enjoy your meal', 'بالهناء والشفاء'],
    'order.step.completed': ['Completed', 'مكتمل'],
    'order.step.completedHint': ['Thanks for dining with us', 'شكراً لزيارتك'],
    'order.cancelledBody': ['This order was cancelled.', 'تم إلغاء هذا الطلب.'],
    'order.cancelThis': ['Cancel this order', 'إلغاء هذا الطلب'],
    'order.cancelHint': ['You can cancel until the restaurant confirms your order.', 'يمكنك الإلغاء حتى يؤكد المطعم طلبك.'],
    'order.cancelTitle': ['Cancel this order?', 'إلغاء هذا الطلب؟'],
    'order.cancelBody': ['The kitchen will not prepare it. This cannot be undone.', 'لن يقوم المطبخ بتحضيره. لا يمكن التراجع عن هذا.'],
    'order.keepIt': ['Keep it', 'الاحتفاظ به'],
    'order.cancelled': ['Your order has been cancelled', 'تم إلغاء طلبك'],
    'order.startedNotice': ['The kitchen has started your order — ask a member of staff if you need to change it.', 'بدأ المطبخ بتحضير طلبك — اسأل أحد الموظفين إن أردت تعديله.'],
    'order.update': ['Order update: {status}', 'تحديث الطلب: {status}'],
    'order.howWasIt': ['How was it?', 'كيف كانت التجربة؟'],
    'order.feedbackBody': ['Your feedback goes straight to the restaurant.', 'تصل ملاحظاتك مباشرة إلى المطعم.'],
    'order.leaveReview': ['Leave a review', 'اكتب تقييماً'],
    'order.comment': ['Comment (optional)', 'تعليق (اختياري)'],
    'order.notNow': ['Not now', 'ليس الآن'],
    'order.sendReview': ['Send review', 'إرسال التقييم'],
    'order.reviewThanks': ['Thank you for your feedback!', 'شكراً لملاحظاتك!'],
    'order.stars': ['{n} stars', '{n} نجوم'],

    // ---- payment --------------------------------------------------------
    'pay.payNow': ['Pay now', 'ادفع الآن'],
    'pay.title': ['Pay for order {code}', 'دفع الطلب {code}'],
    'pay.amountDue': ['Amount due', 'المبلغ المستحق'],
    'pay.cardNumber': ['Card number', 'رقم البطاقة'],
    'pay.expiry': ['Expiry', 'تاريخ الانتهاء'],
    'pay.cvc': ['CVC', 'رمز التحقق'],
    'pay.nameOnCard': ['Name on card', 'الاسم على البطاقة'],
    'pay.payAmount': ['Pay {amount}', 'ادفع {amount}'],
    'pay.processing': ['Processing…', 'جارٍ المعالجة…'],
    'pay.success': ['Payment received — thank you!', 'تم استلام الدفع — شكراً لك!'],
    'pay.simulatorNotice': [
      'Demonstration mode: this is a simulated payment. No card is charged and no card details leave this page in a usable form.',
      'وضع العرض التوضيحي: هذه عملية دفع محاكاة. لا يتم خصم أي مبلغ ولا تُرسل بيانات بطاقة حقيقية.',
    ],
    'pay.testCards': ['Test cards', 'بطاقات الاختبار'],
    'pay.orPayAtTable': ['Or pay a member of staff at the table.', 'أو ادفع لأحد الموظفين على الطاولة.'],
    'pay.alreadyPaid': ['This order is paid', 'تم دفع هذا الطلب'],
    'pay.thanks': ['Thank you — payment received.', 'شكراً لك — تم استلام الدفع.'],
    'pay.notAvailable': ['Paying from the table is not enabled for this restaurant.', 'الدفع من الطاولة غير مفعّل في هذا المطعم.'],

    // ---- my orders ------------------------------------------------------
    'orders.title': ['My orders', 'طلباتي'],
    'orders.onThisDevice': ['On this device', 'على هذا الجهاز'],
    'orders.findByCode': ['Find an order by code', 'ابحث عن طلب بالرمز'],
    'orders.track': ['Track', 'تتبع'],
    'orders.recent': ['Recent orders', 'الطلبات الأخيرة'],
    'orders.emptyBody': ['You have not placed any orders from this device yet.', 'لم تقم بأي طلب من هذا الجهاز بعد.'],
    'orders.findRestaurant': ['Find a restaurant', 'ابحث عن مطعم'],

    // ---- login ----------------------------------------------------------
    'login.subtitle': ['Sign in to the restaurant dashboard', 'سجّل الدخول إلى لوحة تحكم المطعم'],
    'login.signingIn': ['Signing in…', 'جارٍ تسجيل الدخول…'],
    'login.demoAccounts': ['Demo accounts', 'حسابات تجريبية'],
    'login.backToGuest': ['Back to the guest site', 'العودة إلى موقع الضيوف'],

    // ---- 404 ------------------------------------------------------------
    'notFound.title': ['We could not find that page', 'لم نتمكن من العثور على هذه الصفحة'],
    'notFound.body': ['The link may be out of date. If you are trying to order, scan the QR code on your table again — each table has its own code.', 'قد يكون الرابط قديماً. إذا كنت تريد الطلب، امسح رمز طاولتك مرة أخرى — لكل طاولة رمزها الخاص.'],
    'notFound.home': ['Go to the home page', 'الذهاب للصفحة الرئيسية'],

    // ---- dashboard nav --------------------------------------------------
    'nav.service': ['Service', 'الخدمة'],
    'nav.manage': ['Manage', 'الإدارة'],
    'nav.platform': ['Platform', 'المنصة'],
    'nav.overview': ['Overview', 'نظرة عامة'],
    'nav.liveOrders': ['Live orders', 'الطلبات المباشرة'],
    'nav.kitchen': ['Kitchen display', 'شاشة المطبخ'],
    'nav.requests': ['Guest requests', 'طلبات الضيوف'],
    'nav.tables': ['Tables & QR codes', 'الطاولات ورموز QR'],
    'nav.menu': ['Menu', 'القائمة'],
    'nav.reports': ['Reports', 'التقارير'],
    'nav.staff': ['Staff', 'الموظفون'],
    'nav.settings': ['Settings', 'الإعدادات'],
    'nav.restaurants': ['Restaurants', 'المطاعم'],
    'nav.users': ['Users', 'المستخدمون'],
    'nav.allOrders': ['All orders', 'كل الطلبات'],
    'nav.audit': ['Audit log', 'سجل التدقيق'],
    'nav.viewGuestSite': ['View guest site', 'عرض موقع الضيوف'],
    'nav.platformConsole': ['Platform console', 'وحدة تحكم المنصة'],
    'nav.adminViewing': ['Platform admin view — you are managing "{name}"', 'عرض مدير المنصة — أنت تدير "{name}"'],
    'nav.exit': ['Exit', 'خروج'],
    'nav.changePassword': ['Change my password', 'تغيير كلمة المرور'],

    // ---- dashboard overview ---------------------------------------------
    'dash.todayOrders': ["Today's orders", 'طلبات اليوم'],
    'dash.todayRevenue': ["Today's revenue", 'إيرادات اليوم'],
    'dash.stillOpen': ['{n} still open', '{n} ما زالت مفتوحة'],
    'dash.avgPerOrder': ['Avg {amount} per order', 'المتوسط {amount} لكل طلب'],
    'dash.tablesOccupied': ['Tables occupied', 'الطاولات المشغولة'],
    'dash.tablesFree': ['{n} free', '{n} متاحة'],
    'dash.guestRequests': ['Guest requests', 'طلبات الضيوف'],
    'dash.needsAttention': ['Needs attention', 'تحتاج انتباهاً'],
    'dash.allClear': ['All clear', 'لا يوجد شيء'],
    'dash.inProgress': ['Orders in progress', 'الطلبات الجارية'],
    'dash.openBoard': ['Open board', 'فتح اللوحة'],
    'dash.nothingInProgress': ['Nothing in progress right now.', 'لا توجد طلبات جارية الآن.'],
    'dash.last7': ['Last 7 days', 'آخر ٧ أيام'],
    'dash.recentOrders': ['Recent orders', 'الطلبات الأخيرة'],
    'dash.noOrdersToday': ['No orders yet today.', 'لا توجد طلبات اليوم بعد.'],
    'dash.topSellers': ['Top sellers · 7 days', 'الأكثر مبيعاً · ٧ أيام'],
    'dash.notEnoughData': ['Not enough data yet.', 'لا توجد بيانات كافية بعد.'],
    'dash.guestRating': ['Guest rating', 'تقييم الضيوف'],
    'dash.reviews': ['{n} reviews', '{n} تقييم'],
    'dash.revenuePerDay': ['Revenue per day', 'الإيرادات اليومية'],
    'dash.code': ['Code', 'الرمز'],
    'dash.placed': ['Placed', 'وقت الطلب'],

    // ---- orders board ---------------------------------------------------
    'board.inProgress': ['In progress', 'قيد التنفيذ'],
    'board.searchPlaceholder': ['Search code, guest or table', 'ابحث برمز أو ضيف أو طاولة'],
    'board.nothingActive': ['No orders in progress. Enjoy the quiet.', 'لا توجد طلبات جارية. استمتع بالهدوء.'],
    'board.noMatch': ['No orders match these filters.', 'لا توجد طلبات مطابقة.'],
    'board.accept': ['Accept', 'قبول'],
    'board.startCooking': ['Start cooking', 'ابدأ التحضير'],
    'board.markReady': ['Mark ready', 'جاهز'],
    'board.markServed': ['Mark served', 'تم التقديم'],
    'board.closeOrder': ['Close order', 'إغلاق الطلب'],
    'board.markedAs': ['Order marked {status}', 'تم تعيين الطلب: {status}'],
    'board.guest': ['Guest', 'الضيف'],
    'board.timeline': ['Timeline', 'المسار الزمني'],
    'board.payment': ['Payment', 'الدفع'],
    'board.markPaid': ['Mark as paid', 'تعيين كمدفوع'],
    'board.refund': ['Refund', 'استرداد'],
    'board.markedPaid': ['Marked as paid', 'تم التعيين كمدفوع'],
    'board.markedRefunded': ['Marked as refunded', 'تم التعيين كمسترد'],
    'board.cancelOrder': ['Cancel order', 'إلغاء الطلب'],
    'board.cancelTitle': ['Cancel order {code}?', 'إلغاء الطلب {code}؟'],
    'board.cancelBody': ['The guest will be notified immediately. This cannot be undone.', 'سيتم إبلاغ الضيف فوراً. لا يمكن التراجع.'],
    'board.newOrder': ['New order {code} · {table}', 'طلب جديد {code} · {table}'],
    'board.minAgo': ['{n} min ago', 'قبل {n} دقيقة'],
    'board.unit': ['Unit', 'سعر الوحدة'],
    'board.orderCount': ['{n} orders', '{n} طلب'],

    // ---- kitchen --------------------------------------------------------
    'kds.new': ['New', 'جديد'],
    'kds.confirmed': ['Confirmed', 'مؤكد'],
    'kds.cooking': ['Cooking', 'قيد الطهي'],
    'kds.readyToServe': ['Ready to serve', 'جاهز للتقديم'],
    'kds.start': ['Start', 'ابدأ'],
    'kds.ready': ['Ready', 'جاهز'],
    'kds.served': ['Served', 'قُدِّم'],
    'kds.allCaughtUp': ['All caught up', 'لا يوجد متأخر'],
    'kds.allCaughtUpBody': ['New tickets appear here the moment a guest sends an order.', 'تظهر الطلبات هنا فور إرسال الضيف لطلبه.'],
    'kds.empty': ['Empty', 'فارغ'],
    'kds.soundOn': ['Sound on', 'الصوت مفعّل'],
    'kds.soundOff': ['Sound off', 'الصوت متوقف'],
    'kds.fullscreen': ['Fullscreen', 'ملء الشاشة'],
    'kds.newTicket': ['New ticket · {table}', 'طلب جديد · {table}'],
    'kds.markedAs': ['Marked {status}', 'تم التعيين: {status}'],

    // ---- menu editor ----------------------------------------------------
    'edit.category': ['Category', 'فئة'],
    'edit.dish': ['Dish', 'طبق'],
    'edit.newCategory': ['New category', 'فئة جديدة'],
    'edit.newDish': ['New dish', 'طبق جديد'],
    'edit.editCategory': ['Edit "{name}"', 'تعديل "{name}"'],
    'edit.editDish': ['Edit "{name}"', 'تعديل "{name}"'],
    'edit.dishesInCategories': ['{items} dishes in {categories} categories', '{items} طبق في {categories} فئة'],
    'edit.markedSoldOut': ['{n} marked sold out', '{n} معلّم كنافد'],
    'edit.everythingAvailable': ['Everything is available', 'كل الأصناف متاحة'],
    'edit.searchDishes': ['Search dishes', 'ابحث في الأطباق'],
    'edit.noMatch': ['No dishes match your search.', 'لا توجد أطباق مطابقة.'],
    'edit.emptyMenu': ['Your menu is empty. Add a category, then add dishes to it.', 'قائمتك فارغة. أضف فئة ثم أضف الأطباق إليها.'],
    'edit.addFirstCategory': ['Add first category', 'أضف أول فئة'],
    'edit.uncategorised': ['Uncategorised', 'بدون فئة'],
    'edit.hiddenFromGuests': ['Hidden from guests', 'مخفي عن الضيوف'],
    'edit.uncategorisedHint': ['These dishes have no category and stay hidden from the guest menu.', 'هذه الأطباق بلا فئة وتبقى مخفية عن قائمة الضيوف.'],
    'edit.noDishesHere': ['No dishes here yet.', 'لا توجد أطباق هنا بعد.'],
    'edit.options': ['Options', 'الخيارات'],
    'edit.available': ['Available', 'متاح'],
    'edit.onMenu': ['On menu', 'في القائمة'],
    'edit.soldOut': ['Sold out', 'نفد'],
    'edit.nowAvailable': ['{name} is now available', '{name} أصبح متاحاً'],
    'edit.nowSoldOut': ['{name} is now sold out', '{name} أصبح نافداً'],
    'edit.iconEmoji': ['Icon (emoji)', 'الأيقونة (إيموجي)'],
    'edit.description': ['Description', 'الوصف'],
    'edit.sortOrder': ['Sort order', 'ترتيب العرض'],
    'edit.visibility': ['Visibility', 'الظهور'],
    'edit.showToGuests': ['Show this category to guests', 'إظهار هذه الفئة للضيوف'],
    'edit.deleteCategoryTitle': ['Delete "{name}"?', 'حذف "{name}"؟'],
    'edit.deleteCategoryBody': ['The {n} dish(es) in it are kept but become uncategorised and hidden from guests until you move them.', 'سيتم الاحتفاظ بالأطباق ({n}) لكنها ستصبح بلا فئة ومخفية عن الضيوف حتى تنقلها.'],
    'edit.deleteDishTitle': ['Delete "{name}"?', 'حذف "{name}"؟'],
    'edit.deleteDishBody': ['Past orders keep their record of this dish, but it disappears from the menu.', 'تحتفظ الطلبات السابقة بسجل هذا الطبق، لكنه يختفي من القائمة.'],
    'edit.prepTime': ['Prep time (minutes)', 'وقت التحضير (دقائق)'],
    'edit.calories': ['Calories (optional)', 'السعرات (اختياري)'],
    'edit.tags': ['Tags', 'الوسوم'],
    'edit.tagsHint': ['Comma separated. Shown as small labels on the guest menu.', 'مفصولة بفواصل. تظهر كوسوم صغيرة في قائمة الضيوف.'],
    'edit.image': ['Image', 'الصورة'],
    'edit.uploadImage': ['Upload image', 'رفع صورة'],
    'edit.uploading': ['Uploading…', 'جارٍ الرفع…'],
    'edit.imageUploaded': ['Image uploaded', 'تم رفع الصورة'],
    'edit.removeImage': ['Remove image', 'إزالة الصورة'],
    'edit.imageHint': ['PNG, JPEG, GIF or WebP, up to 3 MB. Or paste a URL below.', 'PNG أو JPEG أو GIF أو WebP، حتى ٣ ميغابايت. أو الصق رابطاً أدناه.'],
    'edit.imageUrl': ['Image URL', 'رابط الصورة'],
    'edit.availability': ['Availability', 'التوفر'],
    'edit.availableToOrder': ['Available to order', 'متاح للطلب'],
    'edit.highlight': ['Highlight', 'إبراز'],
    'edit.showUnderPopular': ['Show under "Popular right now"', 'إظهاره ضمن "الأكثر طلباً"'],
    'edit.categoryCreated': ['Category created', 'تم إنشاء الفئة'],
    'edit.categoryUpdated': ['Category updated', 'تم تحديث الفئة'],
    'edit.categoryDeleted': ['Category deleted', 'تم حذف الفئة'],
    'edit.dishAdded': ['Dish added', 'تمت إضافة الطبق'],
    'edit.dishUpdated': ['Dish updated', 'تم تحديث الطبق'],
    'edit.dishDeleted': ['Dish deleted', 'تم حذف الطبق'],
    'edit.addDish': ['Add dish', 'إضافة طبق'],
    'edit.createCategory': ['Create category', 'إنشاء فئة'],
    'edit.optionsFor': ['Options for "{name}"', 'خيارات "{name}"'],
    'edit.optionsIntro': ['Option groups let guests choose sizes, sides and extras. A group with a minimum of 1 forces a choice.', 'تتيح مجموعات الخيارات للضيوف اختيار الأحجام والأطباق الجانبية والإضافات. المجموعة بحد أدنى ١ تُلزم بالاختيار.'],
    'edit.noOptionGroups': ['This dish has no option groups yet.', 'لا توجد مجموعات خيارات لهذا الطبق بعد.'],
    'edit.noChoicesYet': ['No choices yet.', 'لا توجد اختيارات بعد.'],
    'edit.newOptionGroup': ['New option group', 'مجموعة خيارات جديدة'],
    'edit.groupName': ['Group name', 'اسم المجموعة'],
    'edit.groupNamePlaceholder': ['e.g. Choose a size', 'مثال: اختر الحجم'],
    'edit.minChoices': ['Minimum choices', 'الحد الأدنى للاختيارات'],
    'edit.maxChoices': ['Maximum choices', 'الحد الأقصى للاختيارات'],
    'edit.addGroup': ['Add group', 'إضافة مجموعة'],
    'edit.choiceName': ['Choice name', 'اسم الخيار'],
    'edit.deleteGroupTitle': ['Delete "{name}"?', 'حذف "{name}"؟'],
    'edit.deleteGroupBody': ['All of its choices are removed too.', 'ستُحذف كل اختياراتها أيضاً.'],
    'edit.groupCount': ['{n} groups', '{n} مجموعة'],
    'edit.arabicName': ['Arabic name', 'الاسم بالعربية'],
    'edit.arabicDescription': ['Arabic description', 'الوصف بالعربية'],
    'edit.arabicHint': ['Shown to guests who switch the menu to Arabic. Leave blank to reuse the primary text.', 'يظهر للضيوف الذين يختارون العربية. اتركه فارغاً لاستخدام النص الأساسي.'],

    // ---- tables ---------------------------------------------------------
    'tables.qrSheet': ['QR sheet', 'ورقة رموز QR'],
    'tables.table': ['Table', 'طاولة'],
    'tables.noTables': ['No tables yet', 'لا توجد طاولات بعد'],
    'tables.noTablesBody': ['Add a table to generate its QR code — that code is what guests scan.', 'أضف طاولة لتوليد رمزها — هذا الرمز هو ما يمسحه الضيوف.'],
    'tables.addFirst': ['Add first table', 'أضف أول طاولة'],
    'tables.summary': ['{tables} tables across {zones} zones', '{tables} طاولة في {zones} منطقة'],
    'tables.printHint': ['Print the QR sheet and stick one code on each table.', 'اطبع ورقة الرموز وألصق رمزاً على كل طاولة.'],
    'tables.seats': ['Seats', 'المقاعد'],
    'tables.activeOrders': ['Active orders', 'الطلبات النشطة'],
    'tables.openCount': ['{n} open', '{n} مفتوح'],
    'tables.zone': ['Zone', 'المنطقة'],
    'tables.label': ['Label', 'التسمية'],
    'tables.newTable': ['New table', 'طاولة جديدة'],
    'tables.editTable': ['Edit {label}', 'تعديل {label}'],
    'tables.codeOptional': ['Code (optional)', 'الرمز (اختياري)'],
    'tables.codeHint': ['This short code is embedded in the QR link.', 'هذا الرمز القصير مضمّن في رابط QR.'],
    'tables.codeGenerate': ['Leave blank to generate one', 'اتركه فارغاً لتوليد رمز'],
    'tables.added': ['Table added', 'تمت إضافة الطاولة'],
    'tables.updated': ['Table updated', 'تم تحديث الطاولة'],
    'tables.deleted': ['Table deleted', 'تم حذف الطاولة'],
    'tables.deleteTitle': ['Delete {label}?', 'حذف {label}؟'],
    'tables.deleteBody': ['Its QR code stops working immediately.', 'سيتوقف رمزها فوراً عن العمل.'],
    'tables.qrTitle': ['{label} · QR code', '{label} · رمز QR'],
    'tables.guestLink': ['Guest link', 'رابط الضيف'],
    'tables.qrExplain': ['Anyone who scans this code lands on your menu with this table already selected.', 'كل من يمسح هذا الرمز يصل إلى قائمتك وهذه الطاولة محددة مسبقاً.'],
    'tables.scanToOrder': ['Scan to see the menu and order', 'امسح لعرض القائمة والطلب'],
    'tables.rotate': ['Rotate code', 'تدوير الرمز'],
    'tables.rotateHint': ['Generates a new code and invalidates the printed one. Use this if a sticker is copied or misused.', 'يولّد رمزاً جديداً ويُبطل المطبوع. استخدمه إذا نُسخ الملصق أو أُسيء استخدامه.'],
    'tables.rotateTitle': ['Rotate this table code?', 'تدوير رمز هذه الطاولة؟'],
    'tables.rotateBody': ['The current printed QR code will stop working immediately.', 'سيتوقف الرمز المطبوع الحالي فوراً عن العمل.'],
    'tables.rotated': ['Code rotated — reprint the QR for this table', 'تم تدوير الرمز — أعد طباعة رمز هذه الطاولة'],
    'tables.downloadPng': ['Download PNG', 'تنزيل PNG'],
    'tables.printableTitle': ['Printable QR sheet', 'ورقة رموز QR للطباعة'],
    'tables.printableBody': ['Print this page, cut along the cards and place one on each table.', 'اطبع هذه الصفحة، قص البطاقات وضع واحدة على كل طاولة.'],
    'tables.backToList': ['Back to list', 'العودة للقائمة'],
    'tables.statusChanged': ['{label} is now {status}', '{label} أصبحت {status}'],
    'status.free': ['Free', 'متاحة'],
    'status.occupied': ['Occupied', 'مشغولة'],
    'status.reserved': ['Reserved', 'محجوزة'],
    'status.inactive': ['Inactive', 'غير مفعّلة'],

    // ---- requests -------------------------------------------------------
    'req.showAll': ['Show all', 'عرض الكل'],
    'req.showOpen': ['Show open only', 'عرض المفتوحة فقط'],
    'req.noneOpen': ['No open requests', 'لا توجد طلبات مفتوحة'],
    'req.noneRecorded': ['No requests recorded', 'لا توجد طلبات مسجلة'],
    'req.body': ['When a guest taps "Call a waiter" or "Request the bill", it appears here instantly.', 'عندما يضغط الضيف "نادِ النادل" أو "اطلب الفاتورة"، يظهر هنا فوراً.'],
    'req.waiting': ['{n} guests waiting for attention', '{n} ضيف بانتظار المساعدة'],
    'req.open': ['Open', 'مفتوح'],
    'req.doneLabel': ['Done', 'تم'],
    'req.markHandled': ['Mark handled', 'تم التعامل معه'],
    'req.handled': ['Marked as handled', 'تم التعليم كمُنجز'],
    'req.resolvedAt': ['Resolved {time}', 'تم الحل {time}'],
    'req.unknownTable': ['Unknown table', 'طاولة غير معروفة'],
    'req.type.waiter': ['Call a waiter', 'نداء النادل'],
    'req.type.bill': ['Request the bill', 'طلب الفاتورة'],
    'req.type.water': ['Water', 'ماء'],
    'req.type.cleanup': ['Clear the table', 'تنظيف الطاولة'],

    // ---- reports --------------------------------------------------------
    'rep.last7': ['Last 7 days', 'آخر ٧ أيام'],
    'rep.last30': ['Last 30 days', 'آخر ٣٠ يوماً'],
    'rep.last90': ['Last 90 days', 'آخر ٩٠ يوماً'],
    'rep.exportCsv': ['Export CSV', 'تصدير CSV'],
    'rep.exported': ['Report exported', 'تم تصدير التقرير'],
    'rep.avgTicket': ['Average ticket', 'متوسط الطلب'],
    'rep.perOrder': ['Per order', 'لكل طلب'],
    'rep.taxCollected': ['Tax collected', 'الضريبة المحصلة'],
    'rep.serviceAmount': ['Service {amount}', 'الخدمة {amount}'],
    'rep.cancelled': ['Cancelled', 'ملغاة'],
    'rep.completedOrders': ['{n} completed orders', '{n} طلب مكتمل'],
    'rep.percentOfOrders': ['{n}% of all orders', '{n}% من كل الطلبات'],
    'rep.revenuePerDay': ['Revenue per day', 'الإيرادات اليومية'],
    'rep.ordersByHour': ['Orders by hour', 'الطلبات حسب الساعة'],
    'rep.staffingHint': ['Use this to plan staffing around your busiest service.', 'استخدم هذا لتخطيط عدد الموظفين حسب أوقات الذروة.'],
    'rep.revenueByCategory': ['Revenue by category', 'الإيرادات حسب الفئة'],
    'rep.bestSellers': ['Best sellers', 'الأكثر مبيعاً'],
    'rep.noSales': ['No sales in this period.', 'لا مبيعات في هذه الفترة.'],
    'rep.paymentMethods': ['Payment methods', 'طرق الدفع'],
    'rep.method': ['Method', 'الطريقة'],
    'rep.busiestTables': ['Busiest tables', 'أكثر الطاولات ازدحاماً'],
    'rep.noData': ['No data in this period.', 'لا توجد بيانات في هذه الفترة.'],
    'rep.notEnoughTrend': ['Not enough data for a trend yet.', 'لا توجد بيانات كافية لعرض اتجاه.'],
    'rep.noOrdersWeek': ['No orders in the last week.', 'لا توجد طلبات في الأسبوع الماضي.'],

    // ---- staff ----------------------------------------------------------
    'staff.team': ['Team', 'الفريق'],
    'staff.members': ['{n} members', '{n} عضو'],
    'staff.addMember': ['Add staff member', 'إضافة موظف'],
    'staff.lastSignIn': ['Last sign-in', 'آخر دخول'],
    'staff.thisIsYou': ['This is you', 'هذا أنت'],
    'staff.ownerOnly': ['Owner only', 'المالك فقط'],
    'staff.whatRolesDo': ['What each role can do', 'ماذا يستطيع كل دور'],
    'staff.role.owner': ['Owner', 'المالك'],
    'staff.role.ownerDesc': ['Full access, including staff and billing settings.', 'صلاحية كاملة، بما في ذلك الموظفين وإعدادات الفوترة.'],
    'staff.role.manager': ['Manager', 'المدير'],
    'staff.role.managerDesc': ['Everything except creating or editing owners.', 'كل شيء عدا إنشاء أو تعديل المالكين.'],
    'staff.role.waiter': ['Waiter', 'النادل'],
    'staff.role.waiterDesc': ['Orders, tables and guest requests. Can mark dishes sold out.', 'الطلبات والطاولات وطلبات الضيوف. يمكنه تعليم الأطباق كنافدة.'],
    'staff.role.kitchen': ['Kitchen', 'المطبخ'],
    'staff.role.kitchenDesc': ['Kitchen display and order status only.', 'شاشة المطبخ وحالة الطلبات فقط.'],
    'staff.fullName': ['Full name', 'الاسم الكامل'],
    'staff.emailSignIn': ['Email (used to sign in)', 'البريد الإلكتروني (للدخول)'],
    'staff.emailFixed': ['Sign-in addresses cannot be changed. Create a new account instead.', 'لا يمكن تغيير بريد الدخول. أنشئ حساباً جديداً بدلاً من ذلك.'],
    'staff.newPassword': ['New password (leave blank to keep)', 'كلمة مرور جديدة (اتركها فارغة للإبقاء)'],
    'staff.passwordHint': ['At least 8 characters.', '٨ أحرف على الأقل.'],
    'staff.added': ['Staff member added', 'تمت إضافة الموظف'],
    'staff.updated': ['Staff member updated', 'تم تحديث الموظف'],
    'staff.removed': ['Staff member removed', 'تمت إزالة الموظف'],
    'staff.removeTitle': ['Remove {name}?', 'إزالة {name}؟'],
    'staff.removeBody': ['They lose access immediately. Past orders they handled are kept.', 'سيفقد الوصول فوراً. تبقى الطلبات التي تعامل معها محفوظة.'],
    'staff.remove': ['Remove', 'إزالة'],
    'staff.editMember': ['Edit {name}', 'تعديل {name}'],
    'staff.active': ['Active', 'نشط'],
    'staff.disabled': ['Disabled', 'معطّل'],
    'staff.changePasswordTitle': ['Change your password', 'تغيير كلمة المرور'],
    'staff.currentPassword': ['Current password', 'كلمة المرور الحالية'],
    'staff.newPasswordLabel': ['New password', 'كلمة المرور الجديدة'],
    'staff.updatePassword': ['Update password', 'تحديث كلمة المرور'],
    'staff.passwordUpdated': ['Password updated', 'تم تحديث كلمة المرور'],

    // ---- settings -------------------------------------------------------
    'set.profile': ['Restaurant profile', 'ملف المطعم'],
    'set.cuisine': ['Cuisine', 'نوع المطبخ'],
    'set.contactEmail': ['Contact email', 'بريد التواصل'],
    'set.address': ['Address', 'العنوان'],
    'set.openingHours': ['Opening hours', 'ساعات العمل'],
    'set.logoUrl': ['Logo image URL', 'رابط الشعار'],
    'set.brandColour': ['Brand colour', 'لون العلامة'],
    'set.brandColourHint': ['Used across the guest menu.', 'يُستخدم في قائمة الضيوف.'],
    'set.currencyCharges': ['Currency & charges', 'العملة والرسوم'],
    'set.currencyCode': ['Currency code', 'رمز العملة'],
    'set.currencyHint': ['ISO code, e.g. USD, EUR, SAR, AED.', 'رمز ISO، مثل USD أو EUR أو SAR أو AED.'],
    'set.taxRate': ['Tax rate (%)', 'نسبة الضريبة (%)'],
    'set.serviceRate': ['Service charge (%)', 'رسوم الخدمة (%)'],
    'set.chargesHint': ['Service charge is applied to the subtotal; tax is then applied to the subtotal plus service charge.', 'تُطبق رسوم الخدمة على المجموع الفرعي، ثم تُطبق الضريبة على المجموع الفرعي مع رسوم الخدمة.'],
    'set.ordering': ['Ordering', 'الطلبات'],
    'set.acceptOrders': ['Accept online orders', 'قبول الطلبات الإلكترونية'],
    'set.acceptOrdersHint': ['Turn this off at closing time. Guests can still browse the menu but cannot send an order.', 'أوقفه عند الإغلاق. يمكن للضيوف التصفح لكن لا يمكنهم إرسال طلب.'],
    'set.autoAccept': ['Auto-confirm new orders', 'تأكيد الطلبات تلقائياً'],
    'set.autoAcceptHint': ['Orders skip the "pending" step and land in the kitchen straight away.', 'تتخطى الطلبات مرحلة "بانتظار التأكيد" وتصل للمطبخ مباشرة.'],
    'set.onlinePayments': ['Let guests pay from their phone', 'السماح بالدفع من الهاتف'],
    'set.onlinePaymentsHint': ['Adds a "Pay now" button to the guest order screen.', 'يضيف زر "ادفع الآن" إلى شاشة الطلب.'],
    'set.paymentProviderMock': ['Currently using the built-in simulator — no real money moves. Set STRIPE_SECRET_KEY to take real payments.', 'يستخدم حالياً المحاكي المدمج — لا تتم أي عمليات دفع حقيقية. اضبط STRIPE_SECRET_KEY لقبول مدفوعات حقيقية.'],
    'set.paymentProviderLive': ['Connected to Stripe. Guests are charged for real.', 'متصل بـ Stripe. سيتم خصم المبالغ فعلياً من الضيوف.'],
    'set.yourMenuLink': ['Your menu link', 'رابط قائمتك'],
    'set.menuLinkHint': ['Share this to let anyone browse the menu. To place an order, guests must scan a table QR code.', 'شارك هذا الرابط ليتصفح أي شخص القائمة. لإرسال طلب، يجب مسح رمز الطاولة.'],
    'set.preview': ['Preview', 'معاينة'],
    'set.qrCodes': ['QR codes', 'رموز QR'],
    'set.account': ['Account', 'الحساب'],
    'set.plan': ['Plan', 'الباقة'],
    'set.planHint': ['Plan changes and the public address are managed by the platform administrator.', 'تغييرات الباقة والعنوان العام يديرها مسؤول المنصة.'],
    'set.saved': ['Settings saved', 'تم حفظ الإعدادات'],
    'set.saveSettings': ['Save settings', 'حفظ الإعدادات'],
    'set.arabicSection': ['Arabic content', 'المحتوى العربي'],

    // ---- admin ----------------------------------------------------------
    'adm.overview': ['Platform overview', 'نظرة عامة على المنصة'],
    'adm.restaurants': ['Restaurants', 'المطاعم'],
    'adm.totalOrders': ['Total orders', 'إجمالي الطلبات'],
    'adm.grossVolume': ['Gross volume', 'إجمالي المبيعات'],
    'adm.userAccounts': ['User accounts', 'حسابات المستخدمين'],
    'adm.statusBreakdown': ['{active} active · {pending} pending · {suspended} suspended', '{active} نشط · {pending} معلق · {suspended} موقوف'],
    'adm.todayCount': ['{n} today', '{n} اليوم'],
    'adm.todayAmount': ['{amount} today', '{amount} اليوم'],
    'adm.leads': ['{n} inbound leads', '{n} طلب تواصل'],
    'adm.ordersPerDay': ['Orders per day · last 14 days', 'الطلبات اليومية · آخر ١٤ يوماً'],
    'adm.leaderboard': ['Revenue leaderboard', 'ترتيب الإيرادات'],
    'adm.plans': ['Plans', 'الباقات'],
    'adm.accountsByRole': ['Accounts by role', 'الحسابات حسب الدور'],
    'adm.noRestaurants': ['No restaurants yet.', 'لا توجد مطاعم بعد.'],
    'adm.gmvNote': ['Gross volume aggregates every tenant regardless of their own currency setting, so treat it as a relative indicator.', 'يجمع إجمالي المبيعات كل المطاعم بغض النظر عن عملاتها، لذا اعتبره مؤشراً نسبياً.'],
    'adm.restaurantCount': ['{n} restaurants', '{n} مطعم'],
    'adm.onboard': ['Onboard restaurant', 'إضافة مطعم'],
    'adm.onboardTitle': ['Onboard a restaurant', 'إضافة مطعم جديد'],
    'adm.searchRestaurants': ['Search name, address or email', 'ابحث بالاسم أو العنوان أو البريد'],
    'adm.noMatch': ['No restaurants match these filters.', 'لا توجد مطاعم مطابقة.'],
    'adm.onboardFirst': ['Onboard the first restaurant', 'أضف أول مطعم'],
    'adm.noDescription': ['No description.', 'لا يوجد وصف.'],
    'adm.dishes': ['Dishes', 'الأطباق'],
    'adm.tables': ['Tables', 'الطاولات'],
    'adm.staffCurrency': ['{n} staff · {currency}', '{n} موظف · {currency}'],
    'adm.joined': ['Joined {date}', 'انضم {date}'],
    'adm.openDashboard': ['Open dashboard', 'فتح لوحة التحكم'],
    'adm.suspend': ['Suspend', 'إيقاف'],
    'adm.reactivate': ['Reactivate', 'إعادة تفعيل'],
    'adm.suspendTitle': ['Suspend {name}?', 'إيقاف {name}؟'],
    'adm.suspendBody': ['Staff are signed out of the dashboard and guests cannot open the menu or place orders.', 'سيخرج الموظفون من اللوحة ولن يتمكن الضيوف من فتح القائمة أو الطلب.'],
    'adm.reactivateTitle': ['Reactivate {name}?', 'إعادة تفعيل {name}؟'],
    'adm.reactivateBody': ['Staff regain access and the menu becomes public again.', 'يستعيد الموظفون الوصول وتعود القائمة للعامة.'],
    'adm.suspended': ['Restaurant suspended', 'تم إيقاف المطعم'],
    'adm.reactivated': ['Restaurant reactivated', 'تمت إعادة تفعيل المطعم'],
    'adm.deleteTitle': ['Permanently delete {name}?', 'حذف {name} نهائياً؟'],
    'adm.deleteBody': ['Its menu, tables, staff accounts and full order history are deleted. This cannot be undone.', 'ستُحذف قائمته وطاولاته وحسابات موظفيه وكامل سجل الطلبات. لا يمكن التراجع.'],
    'adm.deleteEverything': ['Delete everything', 'حذف كل شيء'],
    'adm.confirmDeletion': ['Confirm deletion', 'تأكيد الحذف'],
    'adm.typeToConfirm': ['Type {slug} to confirm.', 'اكتب {slug} للتأكيد.'],
    'adm.deletePermanently': ['Delete permanently', 'حذف نهائي'],
    'adm.deleted': ['Restaurant deleted', 'تم حذف المطعم'],
    'adm.webAddress': ['Web address', 'العنوان الإلكتروني'],
    'adm.webAddressHint': ['Used as /r/<address>.', 'يُستخدم كـ /r/<العنوان>.'],
    'adm.slugChangeHint': ['Changing this invalidates every printed QR code.', 'تغييره يُبطل كل رموز QR المطبوعة.'],
    'adm.autoFromName': ['auto from the name', 'تلقائي من الاسم'],
    'adm.starterTables': ['Starter tables', 'طاولات أولية'],
    'adm.starterTablesHint': ['Created with QR codes ready to print.', 'تُنشأ مع رموز QR جاهزة للطباعة.'],
    'adm.ownerAccount': ['Owner account', 'حساب المالك'],
    'adm.ownerName': ['Owner name', 'اسم المالك'],
    'adm.ownerEmail': ['Owner email', 'بريد المالك'],
    'adm.tempPassword': ['Temporary password', 'كلمة مرور مؤقتة'],
    'adm.tempPasswordHint': ['Share it with the owner — they can change it from Settings.', 'شاركها مع المالك — يمكنه تغييرها من الإعدادات.'],
    'adm.createRestaurant': ['Create restaurant', 'إنشاء مطعم'],
    'adm.onboarded': ['Restaurant onboarded', 'تمت إضافة المطعم'],
    'adm.updated': ['Restaurant updated', 'تم تحديث المطعم'],
    'adm.acceptingOrders': ['Accepting online orders', 'يقبل الطلبات الإلكترونية'],
    'adm.allRoles': ['All roles', 'كل الأدوار'],
    'adm.allRestaurants': ['All restaurants', 'كل المطاعم'],
    'adm.anyStatus': ['Any status', 'أي حالة'],
    'adm.searchUsers': ['Search name or email', 'ابحث بالاسم أو البريد'],
    'adm.searchOrderCode': ['Search by order code', 'ابحث برمز الطلب'],
    'adm.accounts': ['Accounts', 'الحسابات'],
    'adm.noUsers': ['No users match these filters.', 'لا يوجد مستخدمون مطابقون.'],
    'adm.newUser': ['New user', 'مستخدم جديد'],
    'adm.createUser': ['Create user', 'إنشاء مستخدم'],
    'adm.userCreated': ['User created', 'تم إنشاء المستخدم'],
    'adm.userUpdated': ['User updated', 'تم تحديث المستخدم'],
    'adm.userDeleted': ['User deleted', 'تم حذف المستخدم'],
    'adm.deleteUserTitle': ['Delete {name}?', 'حذف {name}؟'],
    'adm.deleteUserBody': ['{email} loses access immediately. This cannot be undone.', 'سيفقد {email} الوصول فوراً. لا يمكن التراجع.'],
    'adm.deleteUser': ['Delete user', 'حذف المستخدم'],
    'adm.platformLabel': ['Platform', 'المنصة'],
    'adm.emailFixed': ['Sign-in addresses cannot be changed.', 'لا يمكن تغيير بريد الدخول.'],
    'adm.restaurantFieldHint': ['Platform administrators are not tied to a restaurant.', 'مسؤولو المنصة غير مرتبطين بمطعم.'],
    'adm.noOrders': ['No orders match these filters.', 'لا توجد طلبات مطابقة.'],
    'adm.view': ['View', 'عرض'],
    'adm.allActions': ['All actions', 'كل الإجراءات'],
    'adm.auditHint': ['Newest first · latest 150 entries', 'الأحدث أولاً · آخر ١٥٠ سجلاً'],
    'adm.activity': ['Activity', 'النشاط'],
    'adm.noAudit': ['No audit entries match these filters.', 'لا توجد سجلات مطابقة.'],
    'adm.when': ['When', 'الوقت'],
    'adm.actor': ['Actor', 'المنفّذ'],
    'adm.action': ['Action', 'الإجراء'],
    'adm.entity': ['Entity', 'الكيان'],
  };

  // -------------------------------------------------------------------------
  function detectInitial() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && LANGS[stored]) return stored;

    // A URL parameter wins on first visit, so a restaurant can print an
    // Arabic-first QR link if it wants to.
    const fromUrl = new URLSearchParams(location.search).get('lang');
    if (fromUrl && LANGS[fromUrl]) return fromUrl;

    const browser = (navigator.language || 'en').slice(0, 2).toLowerCase();
    return LANGS[browser] ? browser : 'en';
  }

  let current = detectInitial();

  function apply() {
    const meta = LANGS[current];
    document.documentElement.lang = current;
    document.documentElement.dir = meta.dir;
    document.documentElement.setAttribute('data-lang', current);
  }

  /**
   * Translate a key. `params` fills {placeholders}.
   * An unknown key returns the key itself so a gap is visible, not silent.
   */
  function t(key, params) {
    const entry = STRINGS[key];
    let text = entry ? (current === 'ar' ? entry[1] : entry[0]) : key;
    if (params) {
      for (const [name, value] of Object.entries(params)) {
        text = text.split(`{${name}}`).join(String(value));
      }
    }
    return text;
  }

  /**
   * Pick the right variant of restaurant-authored content.
   * Falls back to the primary field when no Arabic copy has been entered.
   */
  function localised(row, field) {
    if (!row) return '';
    if (current === 'ar') {
      const arabic = row[`${field}_ar`];
      if (arabic) return arabic;
    }
    return row[field] || '';
  }

  function setLanguage(lang) {
    if (!LANGS[lang] || lang === current) return;
    current = lang;
    localStorage.setItem(STORAGE_KEY, lang);
    apply();
    location.reload();
  }

  /** A compact EN/العربية switch, used in every header. */
  function switcher(options) {
    const opts = options || {};
    const wrap = document.createElement('div');
    wrap.className = 'pill-toggle lang-switch';
    if (opts.compact) wrap.classList.add('lang-switch-compact');

    for (const [code, meta] of Object.entries(LANGS)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = meta.native;
      button.lang = code;
      button.setAttribute('aria-label', `Switch to ${meta.name}`);
      if (code === current) {
        button.className = 'active';
        button.setAttribute('aria-current', 'true');
      }
      button.addEventListener('click', () => setLanguage(code));
      wrap.appendChild(button);
    }
    return wrap;
  }

  /**
   * Translate static markup in place.
   *
   * Elements opt in with data-i18n="key" (text content),
   * data-i18n-placeholder / data-i18n-title / data-i18n-aria for attributes.
   * Page scripts use t() directly; this covers the hand-written HTML.
   */
  function applyDom(root) {
    const scope = root || document;

    scope.querySelectorAll('[data-i18n]').forEach((node) => {
      node.textContent = t(node.dataset.i18n);
    });
    scope.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
      node.setAttribute('placeholder', t(node.dataset.i18nPlaceholder));
    });
    scope.querySelectorAll('[data-i18n-title]').forEach((node) => {
      node.setAttribute('title', t(node.dataset.i18nTitle));
    });
    scope.querySelectorAll('[data-i18n-aria]').forEach((node) => {
      node.setAttribute('aria-label', t(node.dataset.i18nAria));
    });

    // Any element that should host the language switch.
    scope.querySelectorAll('[data-lang-switch]').forEach((node) => {
      if (node.childElementCount) return;
      node.appendChild(switcher({ compact: node.dataset.langSwitch === 'compact' }));
    });
  }

  apply();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => applyDom());
  } else {
    applyDom();
  }

  window.I18n = {
    get lang() { return current; },
    get dir() { return LANGS[current].dir; },
    get locale() { return LANGS[current].locale; },
    get isRtl() { return LANGS[current].dir === 'rtl'; },
    languages: LANGS,
    t,
    localised,
    setLanguage,
    switcher,
    applyDom,
  };
})();
