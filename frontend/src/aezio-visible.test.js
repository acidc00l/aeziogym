// AezioGym: ejercicios visibles, nombres de Aezio y búsqueda sin tildes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setAezioBuild } from './lib/build-caps.js'
import { allExercises, EXIDX, visibleCatalogue, setVisibleExercises, searchExercises, bodyParts } from './lib/exercises.js'
import { _setAezioNames, _setLangState, exerciseNameFor, exerciseNameClass, descFor, exerciseNameSearchText } from './lib/i18n-core.js'
import NAMES from './aezio/names-es.json'

describe('AezioGym: visibles', () => {
  beforeAll(() => setAezioBuild(true))
  afterAll(() => { setVisibleExercises(null); setAezioBuild(false); _setAezioNames(null); _setLangState('en', {}, null, null) })

  it('sin lista se ve el catálogo entero', () => {
    setVisibleExercises(null)
    expect(allExercises({}).length).toBeGreaterThan(5000)
  })
  it('con lista solo salen los visibles y los propios; el resto sigue en EXIDX', () => {
    setVisibleExercises(['0025', '0197'])
    const own = { id: 'mi-1', n: 'mi ejercicio', custom: true }
    const all = allExercises({ customEx: [own] })
    expect(all.map(e => e.id)).toEqual(['mi-1', '0025', '0197'])
    expect(visibleCatalogue()).toHaveLength(2)
    expect(EXIDX['0001']).toBeTruthy()
    expect(bodyParts().length).toBeGreaterThan(0)
  })
  it('una lista que no casa con nada se ignora', () => {
    setVisibleExercises(['xx'])
    expect(allExercises({}).length).toBeGreaterThan(5000)
  })
  it('sin modo AezioGym no filtra', () => {
    setVisibleExercises(['0025'])
    setAezioBuild(false)
    expect(allExercises({}).length).toBeGreaterThan(5000)
    setAezioBuild(true)
  })
})

describe('AezioGym: nombres y búsqueda', () => {
  beforeAll(() => { setAezioBuild(true); setVisibleExercises(null); _setAezioNames(NAMES); _setLangState('es', {}, null, { 3533: 'otra cosa' }, true, false) })
  afterAll(() => { setAezioBuild(false); _setAezioNames(null); _setLangState('en', {}, null, null) })

  it('usa el nombre de Aezio, sin el original entre paréntesis ni mayúsculas forzadas', () => {
    expect(exerciseNameFor(EXIDX['0025'])).toBe('Press de banca con barra')
    expect(exerciseNameClass(EXIDX['0025'])).toBe('')
    expect(exerciseNameSearchText(EXIDX['0025'])).toContain('barbell bench press')
  })
  it('un ejercicio propio conserva su nombre', () => {
    expect(exerciseNameFor({ id: '0025', n: 'mío', custom: true })).toBe('mío')
  })
  it('oculta la descripción en inglés si tiene nombre de Aezio', () => {
    expect(descFor(EXIDX['0025'])).toBe('')
  })
  it('busca sin tildes ni mayúsculas', () => {
    const all = allExercises({})
    const ids = q => searchExercises(all, q).map(e => e.id)
    expect(ids('jalon')).toContain('0197')
    expect(ids('JALÓN al pecho')).toContain('0197')
    expect(ids('bulgara')).toContain('3533')
    expect(ids('búlgara')).toContain('3533')
    expect(ids('press banca')).toContain('0025')
  })
})
