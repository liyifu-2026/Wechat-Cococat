import i18n from "i18next"
import { initReactI18next } from "react-i18next"
import en from "./en.json"
import zh from "./zh.json"

/** Match supported locales; default to English for other system languages. */
export function detectSystemLanguage(): "zh" | "en" {
  if (typeof navigator === "undefined") return "en"
  const lang = (navigator.language ?? "").toLowerCase()
  if (lang.startsWith("zh")) return "zh"
  return "en"
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
  },
  lng: detectSystemLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
})

export default i18n
