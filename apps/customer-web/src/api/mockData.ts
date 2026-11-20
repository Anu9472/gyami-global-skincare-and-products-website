import detergentImage from '../assets/gyami/detergent-premium-v2.jpg';
import facewashImage from '../assets/gyami/facewash-trio-premium-v2.jpg';
import goldKesarImage from '../assets/gyami/gold-kesar-facewash.png';
import type { Category, Product, VendorSummary } from './types';

const gyamiGlobal: VendorSummary = {
  id: 'gyami-global',
  name: 'GYAMI Global Private Limited',
  location: 'Maharashtra, India',
  rating: 0,
  productCount: 6,
};

export const mockCategories: Category[] = [
  { id: 'cat-skincare', name: 'Skincare', slug: 'skincare', description: 'Daily cleansing and care rituals', imageUrl: facewashImage },
  { id: 'cat-home-care', name: 'Home Care', slug: 'home-care', description: 'Elevated essentials for the modern home', imageUrl: detergentImage },
];

const money = (amount: number) => ({ amount, currency: 'INR' as const });
const launchDetails = {
  gstInclusive: true as const,
  stockStatus: 'IN_STOCK' as const,
  availableQuantity: 300,
  rating: 0,
  reviewCount: 0,
  featured: true,
  bestSeller: false,
  verified: true,
};

export const mockProducts: Product[] = [
  {
    id: 'prod-vitamin-c-facewash', slug: 'vitamin-c-facewash', name: 'Vitamin C Facewash',
    categoryId: 'cat-skincare', categoryName: 'Skincare', productType: 'VALUE_ADDED', vendor: gyamiGlobal,
    ...launchDetails, price: money(199), mrp: money(249), weight: '100 ml', images: ['/media/gyami-vitamin-c-hero-poster.jpg'],
    description: 'A daily face-cleansing ritual with vitamin C, aloe vera and botanical extracts, presented in GYAMI Global’s signature royal-purple and champagne-gold design.',
    ingredients: ['Aqua', 'Cocamidopropyl Betaine', 'Sodium Lauroyl Sarcosinate', 'Glycerin', '3-O-Ethyl Ascorbic Acid', 'Aloe Vera Extract', 'Orange Extract', 'Licorice Extract', 'Panthenol (Vitamin B5)', 'Allantoin', 'Sodium PCA', 'PEG-7 Glyceryl Cocoate', 'Xanthan Gum', 'Disodium EDTA', 'Sodium Chloride', 'Citric Acid', 'Phenoxyethanol', 'Ethylhexylglycerin', 'Fragrance'], specifications: { 'Collection': 'Daily Routine Skincare', 'Net volume': '100 ml', 'Offer': 'Launch offer' },
  },
  {
    id: 'prod-charcoal-facewash', slug: 'charcoal-facewash', name: 'Charcoal Facewash',
    categoryId: 'cat-skincare', categoryName: 'Skincare', productType: 'VALUE_ADDED', vendor: gyamiGlobal,
    ...launchDetails, price: money(199), mrp: money(249), weight: '100 ml', images: ['/media/gyami-charcoal-hero-poster.jpg'],
    description: 'A charcoal facewash with aloe vera and neem extracts, created for a modern cleansing ritual and presented with the refined GYAMI Global identity.',
    ingredients: ['Aqua', 'Cocamidopropyl Betaine', 'Sodium Lauroyl Sarcosinate', 'Charcoal Powder', 'Aloe Vera Extract', 'Neem Extract', 'Glycerin', 'Panthenol', 'Xanthan Gum', 'Sodium Chloride', 'Citric Acid', 'Phenoxyethanol', 'Ethylhexylglycerin', 'Fragrance'], specifications: { 'Collection': 'Daily Routine Skincare', 'Net volume': '100 ml', 'Offer': 'Launch offer' },
  },
  {
    id: 'prod-haldi-chandan-facewash', slug: 'haldi-chandan-facewash', name: 'Haldi Chandan Facewash',
    categoryId: 'cat-skincare', categoryName: 'Skincare', productType: 'VALUE_ADDED', vendor: gyamiGlobal,
    ...launchDetails, price: money(199), mrp: money(249), weight: '100 ml', images: ['/media/gyami-haldi-hero-poster.jpg'],
    description: 'An Ayurvedic-inspired facewash with turmeric and sandalwood extracts, bringing familiar care ingredients into a contemporary GYAMI Global ritual.',
    ingredients: ['Aqua', 'Sodium Lauroyl Sarcosinate', 'Glycerin', 'Curcuma Longa (Turmeric) Root Extract', 'Santalum Album (Sandalwood) Extract', 'Santalum Album (Sandalwood) Oil', 'Xanthan Gum', 'Panthenol', 'Phenoxyethanol', 'Ethylhexylglycerin', 'Citric Acid'], specifications: { 'Collection': 'Daily Routine Skincare', 'Net volume': '100 ml', 'Offer': 'Launch offer' },
  },
  {
    id: 'prod-gold-kesar-facewash', slug: 'gold-kesar-facewash', name: 'Gold Kesar Facewash',
    categoryId: 'cat-skincare', categoryName: 'Skincare', productType: 'VALUE_ADDED', vendor: gyamiGlobal,
    ...launchDetails, price: money(0), mrp: undefined, stockStatus: 'OUT_OF_STOCK', availableQuantity: 0, weight: '100 ml', images: [goldKesarImage],
    description: 'A premium saffron-inspired cleansing ritual presented in GYAMI Global’s signature royal-purple and champagne-gold design.',
    ingredients: ['Kesar (Saffron) Extract', 'Botanical Extracts'], specifications: { 'Collection': 'Daily Routine Skincare', 'Net volume': '100 ml', 'Availability': 'Launching soon' },
  },
  {
    id: 'prod-facewash-trio-combo', slug: 'facewash-trio-combo', name: 'GYAMI Facewash Trio Combo',
    categoryId: 'cat-skincare', categoryName: 'Skincare', productType: 'VALUE_ADDED', vendor: gyamiGlobal,
    ...launchDetails, price: money(549), mrp: money(747), weight: '3 × 100 ml', images: [facewashImage],
    description: 'The complete GYAMI cleansing ritual: Vitamin C, Charcoal and Haldi Chandan facewash together in one launch collection.',
    ingredients: [], specifications: { 'Collection': 'Daily Routine Skincare', 'Contents': '3 facewashes × 100 ml', 'Offer': 'Launch combo' },
  },
  {
    id: 'prod-detergent-liquid', slug: 'detergent-liquid', name: 'Detergent Liquid',
    categoryId: 'cat-home-care', categoryName: 'Home Care', productType: 'VALUE_ADDED', vendor: gyamiGlobal,
    ...launchDetails, price: money(0), mrp: undefined, stockStatus: 'OUT_OF_STOCK', availableQuantity: 0, weight: '1 L', images: [detergentImage],
    description: 'A liquid detergent for everyday fabric care, carrying the same polished GYAMI Global presentation into the home.',
    ingredients: [], specifications: { 'Collection': 'Premium Home Care', 'Net volume': '1 litre', 'Availability': 'Launching soon' },
  },
];

export const mockVendors = [gyamiGlobal];
