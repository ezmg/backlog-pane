import { describe, expect, test } from 'claude-code/testing'

import { detectLanguage, languageFromLocale, languageFromSetting, strings } from '../hooks/i18n'

describe('language detection', () => {
  test('the option wins when it names a language', async () => {
    expect(detectLanguage({ option: 'es', setting: 'English', lang: 'en_US.UTF-8' })).toBe('es')
    expect(detectLanguage({ option: 'en', setting: 'Español' })).toBe('en')
  })

  test('auto reads the setting, then LC_ALL, LC_MESSAGES, LANG, then Intl', async () => {
    expect(detectLanguage({ option: 'auto', setting: 'Español', lang: 'en_US' })).toBe('es')
    expect(detectLanguage({ option: 'auto', setting: 'English', lang: 'es_ES' })).toBe('en')
    expect(detectLanguage({ option: 'auto', lcAll: 'es_ES.UTF-8', lang: 'en_US' })).toBe('es')
    expect(detectLanguage({ option: 'auto', lcAll: 'C', lcMessages: 'es_MX', lang: 'en_US' })).toBe('es')
    expect(detectLanguage({ option: 'auto', lang: 'es_AR.UTF-8', intl: 'en-US' })).toBe('es')
    expect(detectLanguage({ option: 'auto', lang: 'POSIX', intl: 'es-ES' })).toBe('es')
    expect(detectLanguage({ option: 'auto', intl: 'en-GB' })).toBe('en')
    expect(detectLanguage({ option: 'auto' })).toBe('en')
    expect(detectLanguage({})).toBe('en')
  })

  test('the setting is free text', async () => {
    for (const value of ['Español', 'español', 'Spanish', 'spanish (Spain)', 'Castellano', 'es', 'es-MX', 'ESPANOL']) {
      expect(languageFromSetting(value)).toBe('es')
    }
    for (const value of ['English', 'inglés', 'en', 'French', 'Deutsch']) {
      expect(languageFromSetting(value)).toBe('en')
    }
    expect(languageFromSetting('')).toBe(undefined)
    expect(languageFromSetting(undefined)).toBe(undefined)
    expect(languageFromSetting(3)).toBe(undefined)
  })

  test('locales: C and POSIX say nothing', async () => {
    expect(languageFromLocale('es_ES.UTF-8')).toBe('es')
    expect(languageFromLocale('es-419')).toBe('es')
    expect(languageFromLocale('fr_FR')).toBe('en')
    expect(languageFromLocale('C.UTF-8')).toBe(undefined)
    expect(languageFromLocale('POSIX')).toBe(undefined)
    expect(languageFromLocale('')).toBe(undefined)
  })
})

describe('strings', () => {
  test('both tables carry every key', async () => {
    expect(Object.keys(strings('es')).sort()).toEqual(Object.keys(strings('en')).sort())
  })

  test('the drafts name the task id exactly as given', async () => {
    expect(strings('en').workPrompt('BL-7')).toBe(
      'Work on BL-7 only. Research the codebase and write an implementation plan in the task. Wait for my approval before coding.',
    )
    expect(strings('es').workPrompt('BL-7')).toBe(
      'Trabaja solo en BL-7. Investiga el código y escribe un plan de implementación en la tarea. Espera mi aprobación antes de programar.',
    )
    expect(strings('en').editPrompt('proj-12')).toBe('Update proj-12: ')
    expect(strings('es').editPrompt('proj-12')).toBe('Actualiza proj-12: ')
  })
})
