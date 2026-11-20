import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent } from 'react';

const FILM_START_TIME = 0.9;
const FILM_DISPLAY_TIME = 5000;

type HeroFilm = {
  name: string;
  tabName: string;
  ritual: string;
  ingredients: readonly string[];
  poster: string;
  src?: string;
  image?: string;
};

const films: readonly HeroFilm[] = [
  {
    name: 'Vitamin C',
    tabName: 'Vitamin C',
    ritual: 'Brightening botanicals',
    ingredients: ['Orange extract', 'Vitamin C', 'Aloe vera'],
    src: '/media/gyami-vitamin-c-landscape-4k-web.mp4',
    poster: '/media/gyami-vitamin-c-hero-poster.jpg',
  },
  {
    name: 'Charcoal',
    tabName: 'Charcoal',
    ritual: 'Deep-cleansing minerals',
    ingredients: ['Activated charcoal', 'Neem', 'Aloe vera'],
    src: '/media/gyami-charcoal-landscape-4k-web.mp4',
    poster: '/media/gyami-charcoal-hero-poster.jpg',
  },
  {
    name: 'Haldi · Chandan · Papaya',
    tabName: 'Haldi',
    ritual: 'Ayurvedic-inspired care',
    ingredients: ['Turmeric', 'Sandalwood', 'Botanical extracts'],
    src: '/media/gyami-haldi-chandan-papaya-landscape-playback-web.mp4',
    poster: '/media/gyami-haldi-hero-poster.jpg',
  },
  {
    name: 'Gold Kesar',
    tabName: 'Gold Kesar',
    ritual: 'Saffron radiance ritual',
    ingredients: ['Gold kesar', 'Saffron extract', 'Botanical care'],
    src: '/media/gyami-gold-kesar-landscape-playback-web.mp4',
    poster: '/media/gyami-gold-kesar-hero-poster.jpg',
  },
];

export function GyamiHero() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [mediaStarted, setMediaStarted] = useState(false);
  const videos = useRef<Array<HTMLVideoElement | null>>([]);
  const changing = useRef(false);

  const moveLight = (event: PointerEvent<HTMLElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width - 0.5) * 2;
    const y = ((event.clientY - bounds.top) / bounds.height - 0.5) * 2;
    event.currentTarget.style.setProperty('--pointer-x', x.toFixed(3));
    event.currentTarget.style.setProperty('--pointer-y', y.toFixed(3));
  };

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) setPaused(true);
  }, []);

  useEffect(() => {
    const startMedia = window.setTimeout(() => setMediaStarted(true), 900);
    return () => window.clearTimeout(startMedia);
  }, []);

  useEffect(() => {
    if (paused || !mediaStarted) return undefined;
    const warmVideo = (index: number) => {
      const video = videos.current[index];
      if (!video || video.preload === 'auto') return;
      video.preload = 'auto';
      video.load();
    };
    const nextFilm = window.setTimeout(() => warmVideo((active + 1) % films.length), 2600);
    return () => {
      window.clearTimeout(nextFilm);
    };
  }, [active, mediaStarted, paused]);

  useEffect(() => {
    const video = videos.current[active];
    if (!video || !mediaStarted) return undefined;
    if (paused) video.pause();
    else {
      if (video.currentTime < FILM_START_TIME || video.currentTime > FILM_START_TIME + 5.4) video.currentTime = FILM_START_TIME;
      void video.play().catch(() => setPaused(true));
    }
  }, [active, mediaStarted, paused]);

  const transitionTo = useCallback((index: number) => {
    if (index === active || changing.current) return;
    changing.current = true;
    const next = videos.current[index];
    const previous = videos.current[active];
    if (!films[index]?.src) {
      changing.current = true;
      setActive(index);
      previous?.pause();
      window.setTimeout(() => { changing.current = false; }, 950);
      return;
    }
    if (!next) {
      changing.current = false;
      return;
    }
    next.preload = 'auto';
    if (next.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) next.load();
    next.currentTime = FILM_START_TIME;
    const reveal = () => {
      setActive(index);
      window.setTimeout(() => {
        previous?.pause();
        changing.current = false;
      }, 950);
    };
    if (paused) reveal();
    else void next.play().then(reveal).catch(() => {
      changing.current = false;
      setPaused(true);
    });
  }, [active, paused]);

  useEffect(() => {
    if (paused || !mediaStarted) return undefined;
    const slider = window.setTimeout(() => transitionTo((active + 1) % films.length), FILM_DISPLAY_TIME);
    return () => window.clearTimeout(slider);
  }, [active, mediaStarted, paused, transitionTo]);

  const activeFilm = films[active] ?? films[0]!;

  return (
    <section className="gyami-hero" aria-labelledby="gyami-hero-title" onPointerMove={moveLight}>
      <div className="gyami-hero-film" aria-hidden="true">
        {films.map((film, index) => film.src ? (
          <video
            ref={(node) => { videos.current[index] = node; }}
            className={index === active ? 'is-active' : ''}
            style={{ '--film-rotation': `${index % 2 === 0 ? -0.7 : 0.7}deg` } as CSSProperties}
            key={film.src}
            muted
            onLoadedMetadata={(event) => { event.currentTarget.currentTime = FILM_START_TIME; }}
            playsInline
            poster={film.poster}
            preload="none"
          >
            <source src={film.src} type="video/mp4" />
          </video>
        ) : (
          <img
            alt=""
            aria-hidden="true"
            className={`gyami-hero-product-still${index === active ? ' is-active' : ''}`}
            key={film.name}
            src={film.image}
          />
        ))}
        <div className="gyami-hero-film__veil" />
        <div className="gyami-hero-film__aurora" />
        <div className="gyami-hero-film__grain" />
      </div>
      <div className="gyami-hero-product-name" aria-live="polite"><span>Featured ritual</span><strong>{activeFilm.name}</strong></div>

      <div className="gyami-hero-orbit" aria-hidden="true"><i /><i /><i /></div>
      <div className="gyami-hero-aurora-ribbons" aria-hidden="true"><i /><i /><i /></div>
      <div className="gyami-hero-light" aria-hidden="true" />
      <div className="gyami-hero-dust" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>
      <div className="shell gyami-hero-grid">
        <div className="gyami-hero-copy">
          <p className="gyami-kicker gyami-hero-enter gyami-hero-enter--1">Premium skincare &amp; beauty</p>
          <h1 className="gyami-hero-enter gyami-hero-enter--2" id="gyami-hero-title">Where science<br />meets <em>luxury.</em></h1>
          <p className="gyami-hero-lede gyami-hero-enter gyami-hero-enter--3">Modern cosmetic science, refined aesthetics, and the timeless art of personal care—created in India with a global vision.</p>
          <div className="gyami-ingredient-story gyami-hero-enter gyami-hero-enter--4" aria-live="polite">
            <p>{activeFilm.ritual}</p>
            <div>{activeFilm.ingredients.map((ingredient) => <span key={ingredient}><i aria-hidden="true" />{ingredient}</span>)}</div>
          </div>
          <div className="gyami-hero-actions gyami-hero-enter gyami-hero-enter--4">
            <a className="button gyami-button--gold" href="#collection">Discover the collection</a>
            <a className="gyami-text-link" href="#our-philosophy">Our philosophy</a>
          </div>
        </div>

        <div className="gyami-hero-dots" role="tablist" aria-label="Choose a product film">
          {films.map((film, index) => <button aria-label={`Show ${film.name} film`} aria-selected={active === index} className={active === index ? 'is-active' : ''} key={film.name} onClick={() => transitionTo(index)} role="tab"><i /><span>{film.tabName}</span></button>)}
        </div>
      </div>

      <a className="gyami-scroll-cue" href="#collection"><span>Explore</span><i aria-hidden="true" /></a>
    </section>
  );
}
