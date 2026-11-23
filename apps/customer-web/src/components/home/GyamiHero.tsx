import { useEffect, useState } from 'react';
import { Droplets, Leaf, ShieldCheck, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';

type Ritual = {
  name: string;
  shortName: string;
  eyebrow: string;
  promise: string;
  description: string;
  benefits: readonly string[];
  image: string;
  scene: string;
  href: string;
  tone: string;
};

const rituals: readonly Ritual[] = [
  { name: 'Vitamin C Facewash', shortName: 'Vitamin C', eyebrow: 'Daily radiance ritual', promise: 'Fresh clarity. Naturally luminous skin.', description: 'A bright, refreshing cleanse with vitamin C, orange extract and aloe vera for a comfortable everyday ritual.', benefits: ['Bright-looking skin', 'Fresh daily cleanse', 'Aloe comfort'], image: '/media/gyami-vitamin-c-card.png', scene: '/media/gyami-vitamin-c-card.png', href: '/products/vitamin-c-facewash', tone: 'citrus' },
  { name: 'Charcoal Facewash', shortName: 'Charcoal', eyebrow: 'Deep-cleansing ritual', promise: 'A clean reset for busy, urban skin.', description: 'Activated charcoal, neem and aloe vera come together in a balanced cleanse designed for everyday freshness.', benefits: ['Deep cleanse', 'Oil-control care', 'Fresh finish'], image: '/media/gyami-charcoal-card.png', scene: '/media/gyami-charcoal-card.png', href: '/products/charcoal-facewash', tone: 'charcoal' },
  { name: 'Haldi Chandan Papaya Facewash', shortName: 'Haldi · Chandan', eyebrow: 'Ayurvedic-inspired ritual', promise: 'Tradition, refined for a modern glow.', description: 'Turmeric, sandalwood and papaya-inspired care create a gentle cleansing ritual rooted in familiar botanicals.', benefits: ['Radiance care', 'Smooth-feeling skin', 'Botanical cleanse'], image: '/media/gyami-haldi-card.png', scene: '/media/gyami-haldi-card.png', href: '/products/haldi-chandan-facewash', tone: 'haldi' },
  { name: 'Gold Kesar Facewash', shortName: 'Gold Kesar', eyebrow: 'Saffron radiance ritual', promise: 'A refined cleanse with a golden touch.', description: 'A premium saffron-inspired daily cleanser presented in GYAMI’s signature royal-purple and champagne-gold design.', benefits: ['Saffron-inspired care', 'Daily radiance', 'Premium ritual'], image: '/media/gyami-gold-kesar-card.png', scene: '/media/gyami-gold-kesar-card.png', href: '/products/gold-kesar-facewash', tone: 'kesar' },
];

const heroCopy = rituals[1]!;

export function GyamiHero() {
  const [activeSlide, setActiveSlide] = useState(0);
  const totalSlides = rituals.length;
  const ritual = rituals[activeSlide] ?? rituals[0]!;

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => setActiveSlide((current) => (current + 1) % totalSlides), 5000);
    return () => window.clearInterval(timer);
  }, [totalSlides]);

  return (
    <section className={`ritual-hero ritual-hero--${ritual.tone} ritual-hero--product-slide`} aria-labelledby="ritual-hero-title">
      <div className="ritual-hero__photography" aria-hidden="true"><div className="ritual-hero__photo-wash" /><div className="ritual-hero__botanicals"><span /><span /><span /></div></div>
      <div className={`ritual-hero__featured-product ritual-hero__featured-product--${ritual.tone}`} aria-live="polite"><span className="ritual-hero__featured-glow" aria-hidden="true" /><img key={ritual.image} src={ritual.image} alt={ritual.name} decoding="async" /><span className="ritual-hero__featured-label"><small>Featured ritual</small><strong>{ritual.shortName}</strong></span></div>
      <div className="shell ritual-hero__layout">
        <div className="ritual-hero__copy">
          <p className="ritual-hero__edition"><span>GYAMI skincare</span><i />Made for your daily ritual</p>
          <p className="ritual-hero__eyebrow">{heroCopy.eyebrow}</p>
          <h1 id="ritual-hero-title">{heroCopy.promise}</h1>
          <p className="ritual-hero__description">{heroCopy.description}</p>
          <ul className="ritual-hero__benefits" aria-label={`${heroCopy.name} benefits`}>
            <li><Sparkles aria-hidden="true" />{heroCopy.benefits[0]}</li><li><Droplets aria-hidden="true" />{heroCopy.benefits[1]}</li><li><Leaf aria-hidden="true" />{heroCopy.benefits[2]}</li>
          </ul>
          <div className="ritual-hero__actions"><Link className="button ritual-hero__primary" to={heroCopy.href}>Explore {heroCopy.shortName}</Link><a className="ritual-hero__secondary" href="#collection">Shop all rituals</a></div>
          <p className="ritual-hero__assurance"><ShieldCheck aria-hidden="true" /> Official GYAMI Global product</p>
        </div>
      </div>
    </section>
  );
}
