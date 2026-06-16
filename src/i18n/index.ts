import { de } from './de';
import { en } from './en';
import { fr } from './fr';
import { useState, useEffect } from 'react';

export type Language = 'de' | 'en' | 'fr';

// Loose type definition to prevent build errors when keys are added/removed
export type TranslationKey = keyof typeof de | string;

export const translations = {
  de,
  en,
  fr,
};

// Simple event bus for language changes
const listeners: ((lang: Language) => void)[] = [];

export const setLanguage = (lang: Language) => {
  if (typeof window !== 'undefined') {
    localStorage.setItem('aivideo_lang', lang);
    document.documentElement.lang = lang;
  }
  listeners.forEach((listener) => listener(lang));
};

export const getLanguage = (): Language => {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('aivideo_lang') as Language;
    if (saved && ['de', 'en', 'fr'].includes(saved)) return saved;

    // Browser detection
    const browserLang = navigator.language.split('-')[0];
    if (browserLang === 'de') return 'de';
    if (browserLang === 'fr') return 'fr';
  }
  return 'en'; // Default to English
};

export const useTranslation = () => {
  const [currentLang, setCurrentLang] = useState<Language>(getLanguage());

  useEffect(() => {
    const handler = (lang: Language) => setCurrentLang(lang);
    listeners.push(handler);
    return () => {
      const index = listeners.indexOf(handler);
      if (index > -1) listeners.splice(index, 1);
    };
  }, []);

  const t = (key: TranslationKey): string => {
    // @ts-ignore
    return translations[currentLang][key] || translations['en'][key] || key;
  };

  return { t, lang: currentLang, setLang: setLanguage };
};
