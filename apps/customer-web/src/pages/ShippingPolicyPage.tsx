import { Clock3, Mail, PackageCheck, RotateCcw, ShieldCheck, Truck } from 'lucide-react';

const sections = [
  ['Shipping across India', 'We deliver to serviceable PIN codes across India through recognised partners including Delhivery, Blue Dart, Ekart Logistics, India Post and other authorised providers. International shipping is not currently available.'],
  ['Charges and delivery time', 'Standard domestic shipping is ₹49. Orders with merchandise worth ₹499 or more qualify for free standard shipping. Metro deliveries generally take 3–5 business days after dispatch; other serviceable locations generally take 5–8 business days.'],
  ['Processing and dispatch', 'Orders are generally processed within 1–2 business days after confirmation. Orders placed on Sundays or public holidays are processed on the next working day. Tracking details are shared after dispatch wherever available.'],
  ['Delivery requirements', 'Please provide the recipient’s full name, complete address, city, state, valid PIN code and active mobile number. Courier partners may contact you for delivery coordination or OTP verification.'],
  ['Cancellation', 'You may request cancellation before dispatch. Once an order is handed to the courier, normal cancellation may no longer be possible. Eligible prepaid cancellations are refunded to the original payment method.'],
  ['Returns and exchanges', 'Report visible damage, incorrect delivery or missing items within 48 hours of delivery. Eligible unopened and unused products may be requested for return within 7 days, subject to hygiene requirements and applicable consumer law.'],
  ['Damaged, defective or wrong products', 'Contact support with your order ID, product name, a description and clear photos of the product and packaging where possible. After verification, we may offer a replacement, agreed exchange or eligible refund.'],
  ['Return shipping', 'GYAMI Global bears reasonable return or replacement shipping costs for damaged, defective, incorrect or materially misdescribed products. Any customer-paid charge for an eligible change-of-mind return will be disclosed before acceptance.'],
  ['Refunds', 'Approved refunds are generally initiated within 3–5 business days. Your bank or payment provider may require additional time to credit the amount. Refunds may use the original payment method, UPI or an agreed bank transfer.'],
  ['Cash on delivery', 'COD is available only for eligible PIN codes and orders where it appears at checkout. Availability may depend on courier restrictions and order verification.'],
  ['Failed delivery and delays', 'Courier partners may retry or return an undeliverable shipment. Delivery estimates can be affected by weather, holidays, transport disruption or courier interruptions. Contact support for re-delivery or delay assistance.'],
  ['Non-returnable items', 'Opened cosmetics, opened skincare and used personal-care products are generally not eligible for change-of-mind returns for hygiene and safety reasons. This does not limit valid claims for defective, damaged, incorrect or misdescribed goods.'],
] as const;

const highlights = [
  { icon: Truck, title: 'India-wide delivery', copy: 'Subject to serviceability' },
  { icon: Clock3, title: '3–8 business days', copy: 'Estimated after dispatch' },
  { icon: PackageCheck, title: 'Free over ₹499', copy: 'Otherwise ₹49 standard' },
  { icon: RotateCcw, title: '7-day request window', copy: 'For eligible sealed goods' },
] as const;

export function ShippingPolicyPage() {
  return <main className="policy-page">
    <section className="policy-hero"><div className="shell"><p className="gyami-kicker">Customer care · India</p><h1>Shipping, delivery,<br />returns & refunds.</h1><p>Clear information for every GYAMI Global order—from checkout to delivery and eligible after-sales support.</p><div className="policy-highlights">{highlights.map(({ icon: Icon, title, copy }) => <article key={title}><Icon aria-hidden="true" /><strong>{title}</strong><span>{copy}</span></article>)}</div></div></section>
    <section className="shell policy-content"><div className="policy-intro"><ShieldCheck aria-hidden="true" /><div><h2>Our commitment</h2><p>Every order is carefully checked, securely packed and dispatched through recognised logistics partners. This policy applies to purchases made through our official website for delivery within India.</p></div></div><div className="policy-grid">{sections.map(([title, copy], index) => <article key={title}><span>{String(index + 1).padStart(2, '0')}</span><h2>{title}</h2><p>{copy}</p></article>)}</div><aside className="policy-support"><div><p className="gyami-kicker">Need assistance?</p><h2>We are here to help.</h2><p>We aim to acknowledge consumer complaints within 48 hours and resolve them within one month, in accordance with applicable requirements.</p></div><div><a href="mailto:gyamiglobal@gmail.com"><Mail /> gyamiglobal@gmail.com</a><a href="tel:+918806611432">+91 88066 11432</a></div></aside><p className="policy-note">GYAMI GLOBAL PRIVATE LIMITED may update this policy to reflect operational, logistics or legal changes. The latest version published here applies. These terms do not limit rights available under applicable consumer law.</p></section>
  </main>;
}
