import { useEffect, useState } from 'react';
import { Droplets, Leaf, ShieldCheck, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import ritualImage from '../../assets/gyami/skincare-ritual-hero-v2.jpg';

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

const lifestyle = {
  name: 'The GYAMI cleansing ritual', shortName: 'The ritual', eyebrow: 'Modern skincare ritual',
  promise: 'Cleanse beautifully. Reveal your natural glow.',
  description: 'Begin with a refreshing everyday cleanse, then discover the GYAMI facewash created for your skin ritual.',
  benefits: ['Fresh-feeling skin', 'Mindful daily care', 'Four targeted rituals'] as const,
  scene: ritualImage, href: '#collection', tone: 'lifestyle',
};

export function GyamiHero() {
  const [activeSlide, setActiveSlide] = useState(0);
  const totalSlides = rituals.length + 1;
  const isLifestyle = activeSlide === 0;
  const ritual = rituals[Math.max(0, activeSlide - 1)] ?? rituals[0]!;
  const slide = isLifestyle ? lifestyle : ritual;

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => setActiveSlide((current) => (current + 1) % totalSlides), 1000);
    return () => window.clearInterval(timer);
  }, [totalSlides]);

  return (
    <section className={`ritual-hero ritual-hero--${slide.tone} ${isLifestyle ? 'ritual-hero--lifestyle-slide' : 'ritual-hero--product-slide'}`} aria-labelledby="ritual-hero-title">
      <div className="ritual-hero__photography" aria-hidden="true">{isLifestyle && <img src={slide.scene} alt="" fetchPriority="high" decoding="async" />}<div className="ritual-hero__photo-wash" /><div className="ritual-hero__botanicals"><span /><span /><span /></div></div>
      {!isLifestyle && <div className="ritual-hero__featured-product" aria-live="polite"><span className="ritual-hero__featured-glow" aria-hidden="true" /><img src={ritual.image} alt={ritual.name} decoding="async" /><span className="ritual-hero__featured-label"><small>Featured ritual</small><strong>{ritual.shortName}</strong></span></div>}
      <div className="shell ritual-hero__layout">
        <div className="ritual-hero__copy" key={activeSlide}>
          <p className="ritual-hero__edition"><span>GYAMI skincare</span><i />Made for your daily ritual</p>
          <p className="ritual-hero__eyebrow">{slide.eyebrow}</p>
          <h1 id="ritual-hero-title">{slide.promise}</h1>
          <p className="ritual-hero__description">{slide.description}</p>
          <ul className="ritual-hero__benefits" aria-label={`${slide.name} benefits`}>
            <li><Sparkles aria-hidden="true" />{slide.benefits[0]}</li><li><Droplets aria-hidden="true" />{slide.benefits[1]}</li><li><Leaf aria-hidden="true" />{slide.benefits[2]}</li>
          </ul>
          <div className="ritual-hero__actions">{isLifestyle ? <a className="button ritual-hero__primary" href="#collection">Discover the collection</a> : <Link className="button ritual-hero__primary" to={ritual.href}>Explore {ritual.shortName}</Link>}<a className="ritual-hero__secondary" href="#collection">Shop all rituals</a></div>
          <p className="ritual-hero__assurance"><ShieldCheck aria-hidden="true" /> Official GYAMI Global product</p>
        </div>
      </div>
    </section>
  );
}
