import { CSSProperties, FormEvent, useEffect, useState } from 'react'
import Plot from 'react-plotly.js'

type Result = {
  angles_deg: number[]
  pattern_db: number[]
  profile: { source_units: string; points: number; distances_m: number[]; heights_m: number[]; terrain?: Record<string, unknown> }
  configuration: {
    frequency_mhz: number
    antenna_heights_ft: number[]
    antenna_heights_m?: number[]
    antenna_phases: number[]
    diffraction_disable: boolean
  }
  metadata: { profile_points?: number }
  limitations?: string[]
  metrics?: { peak: { angle_deg: number; value_db: number }; integrated_average_gain: { average_db: number }; beamwidth_3db: { width_deg: number | null }; nulls: { angle_deg: number; value_db: number }[]; figure_of_merit_db?: number }
  flat_pattern_db?: number[]
  aoa?: { band?: string | null; source?: string | null; angles_deg: number[]; probabilities_pct: number[]; available?: boolean; message?: string | null }
  interpretation?: { headline: string; beginner: string; technical: string; observations: string[] }
  ray_trace?: { available: boolean; paths: { kind: string; angle_deg: number; distances_m: number[]; heights_m: number[] }[]; counts: Record<string, number> }
}
type Interpretation = { headline: string; beginner: string; technical: string; observations: string[] }
type Scenario = { name: string; profile_name?: string; angles_deg?: number[]; pattern_db: number[]; flat_pattern_db?: number[]; aoa?: Result['aoa']; metrics?: Result['metrics']; configuration?: Result['configuration']; metadata?: Result['metadata']; profile?: Result['profile']; ray_trace?: Result['ray_trace']; interpretation?: Interpretation; warnings?: string[] }
type CompareResult = { angles_deg: number[]; scenarios: Scenario[]; comparison: { rmse_db: number; max_absolute_delta_db: number; integrated_average_delta_db: number; peak_delta_db: number; pairwise?: { rmse_db: number; max_absolute_delta_db: number; integrated_average_delta_db: number; peak_delta_db: number }[] }; interpretation?: Interpretation; limitations?: string[] }
type AIExplanation = { headline: string; for_leigo: string; melhor_cenario: string; cenarios_analisados: string[]; por_que: string[]; recomendacoes: string[]; cuidados: string[]; confianca: string }
type ScenarioConfig = { name: string; heights: string; antenna_type: string }
type ColorPalette = { rays: Record<string, string>; scenarios: string[]; flatScenarios: string[]; terrain: string; flat: string; aoa: string; event: string; corner: string; antenna: string }

const DEFAULT_PALETTE: ColorPalette = { rays: { direct: '#287bb0', reflected: '#78b7d9', diffracted: '#174f91', double_diffracted: '#102f59' }, scenarios: ['#f2a65a', '#6bd48b', '#78b7d9', '#c58cff'], flatScenarios: ['#c76b5a', '#4f9f78', '#5f8fa8', '#9a6bc0'], terrain: '#171717', flat: '#d93636', aoa: '#d92fc4', event: '#f2a65a', corner: '#ff594f', antenna: '#f2a65a' }
const COLORBLIND_PALETTE: ColorPalette = { rays: { direct: '#0072b2', reflected: '#56b4e9', diffracted: '#d55e00', double_diffracted: '#cc79a7' }, scenarios: ['#0072b2', '#e69f00', '#009e73', '#cc79a7'], flatScenarios: ['#d55e00', '#56b4e9', '#f0e442', '#0072b2'], terrain: '#222222', flat: '#d55e00', aoa: '#009e73', event: '#e69f00', corner: '#cc79a7', antenna: '#0072b2' }
const SCENARIO_DASHES = ['solid', 'dash', 'dot', 'dashdot'] as const
const SCENARIO_SYMBOLS = ['circle', 'square', 'diamond', 'triangle-up'] as const
const RAY_DASHES: Record<string, 'solid' | 'dash' | 'dot' | 'dashdot'> = { direct: 'solid', reflected: 'dash', diffracted: 'dot', double_diffracted: 'dashdot' }

function gainAt(angles: number[], pattern: number[], angle: number) {
  if (!angles.length || !pattern.length) return 0
  const target = Math.abs(angle)
  let nearest = 0
  let distance = Infinity
  angles.forEach((candidate, index) => { const current = Math.abs(candidate - target); if (current < distance) { distance = current; nearest = index } })
  return pattern[nearest] || 0
}

function fitsRayFrame(path: { distances_m: number[]; heights_m: number[] }, endDistance: number, maxHeight = 1000) {
  const heights = path.heights_m.filter((_, index) => path.distances_m[index] <= endDistance + 0.01)
  return heights.length > 1 && Math.max(...heights) <= maxHeight
}

function summarizeRayTrace(rayTrace?: Result['ray_trace']) {
  if (!rayTrace) return null
  const angle_ranges: Record<string, { min_deg: number; max_deg: number }> = {}
  for (const kind of Object.keys(rayTrace.counts || {})) {
    const angles = rayTrace.paths.filter(path => path.kind === kind).map(path => path.angle_deg)
    if (angles.length) angle_ranges[kind] = { min_deg: Math.min(...angles), max_deg: Math.max(...angles) }
  }
  return { available: rayTrace.available, counts: rayTrace.counts, angle_ranges }
}

function ScenarioRayTrace({ scenario, index, angles, rayKinds, onToggle, accessibleColors, accessiblePatterns }: { scenario: Scenario; index: number; angles: number[]; rayKinds: Record<string, boolean>; onToggle: (kind: string) => void; accessibleColors: boolean; accessiblePatterns: boolean }) {
  if (!scenario.ray_trace?.available || !scenario.profile) return null
  const labels: Record<string, string> = { direct: 'Direto', reflected: 'Reflexão', diffracted: 'Difração', double_diffracted: 'Difração dupla' }
  const colors = (accessibleColors ? COLORBLIND_PALETTE : DEFAULT_PALETTE).rays
  const count = Math.min(scenario.profile.points, scenario.profile.distances_m.length, scenario.profile.heights_m.length)
  const distances = scenario.profile.distances_m.slice(0, count)
  const terrain = scenario.profile.heights_m.slice(0, count)
  const end = distances[distances.length - 1] || 0
  const axisEnd = Math.max(500, Math.ceil(end / 500) * 500)
  const terrainAt = (x: number) => { for (let i = 1; i < distances.length; i += 1) if (x <= distances[i]) { const q = distances[i] === distances[i - 1] ? 0 : (x - distances[i - 1]) / (distances[i] - distances[i - 1]); return terrain[i - 1] + (terrain[i] - terrain[i - 1]) * q } return terrain[terrain.length - 1] || 0 }
  const limits: Record<string, number> = { direct: 1000, reflected: 1000, diffracted: 1000, double_diffracted: 1000 }
  const antennaPattern = scenario.flat_pattern_db || scenario.pattern_db
  const paths = Object.keys(limits).flatMap(kind => { const all = [...(scenario.ray_trace?.paths.filter(path => path.kind === kind && rayKinds[kind] !== false && fitsRayFrame(path, end)) || [])]; return all.sort((a, b) => gainAt(angles, antennaPattern, b.angle_deg) - gainAt(angles, antennaPattern, a.angle_deg)).slice(0, limits[kind]).sort((a, b) => a.angle_deg - b.angle_deg) })
  const clip = (path: NonNullable<Result['ray_trace']>['paths'][number]) => path.distances_m.reduce<[number, number][]>((points, x, i) => { if (x <= end && path.heights_m[i] !== undefined) points.push([x, path.heights_m[i]]); return points }, [])
  const visible = paths.map(path => ({ path, points: clip(path) })).filter(item => item.points.length > 1 && (item.path.kind !== 'double_diffracted' || item.points.some(([x, y]) => Math.abs(y - terrainAt(x)) < 4)))
  const gains = visible.map(({ path }) => gainAt(angles, antennaPattern, path.angle_deg))
  const lowGain = Math.min(...gains, 0); const highGain = Math.max(...gains, 1)
  const data: any[] = visible.map(({ path, points }, pathIndex) => { const gain = gains[pathIndex]; const weight = highGain === lowGain ? .45 : .14 + .38 * ((gain - lowGain) / (highGain - lowGain)); return { x: points.map(p => p[0] / 1000), y: points.map(p => p[1]), type: 'scatter', mode: 'lines', name: labels[path.kind], legendgroup: path.kind, showlegend: visible.findIndex(item => item.path.kind === path.kind) === pathIndex, line: { color: colors[path.kind], width: .65 + weight, opacity: weight, dash: accessiblePatterns ? RAY_DASHES[path.kind] : 'solid' }, hovertemplate: `${labels[path.kind]}<br>ângulo de saída: ${path.angle_deg.toFixed(2)}°<br>ganho da antena: ${gain.toFixed(1)} dB<br>%{x:.2f} km · %{y:.1f} m<extra></extra>` } })
  data.push({ x: distances.map(x => x / 1000), y: terrain, type: 'scatter', mode: 'lines+markers', name: 'TERRENO', line: { color: '#171717', width: 2 }, marker: { color: '#111111', size: 3 }, fill: 'tozeroy', fillcolor: 'rgba(194,174,162,.42)' })
  data.push({ x: [0, end / 1000], y: [0, 10], yaxis: 'y2', type: 'scatter', mode: 'lines', line: { color: 'transparent', width: 0 }, opacity: 0, showlegend: false, hoverinfo: 'skip' })
  return <article className="scenario-ray"><div className="terrain-heading"><small>TRAÇADO DE RAIOS · {scenario.name.toUpperCase()}</small><span>{visible.length} trajetórias visíveis · {scenario.ray_trace.paths.length} calculadas · perfil {(end / 1000).toFixed(2)} km</span></div><div className="ray-controls">{Object.entries(labels).map(([kind, label]) => <button type="button" key={`${index}-${kind}`} className={rayKinds[kind] ? 'ray-toggle active' : 'ray-toggle'} onClick={() => onToggle(kind)} style={{ '--ray-color': colors[kind] } as CSSProperties}><i />{label} <small>{scenario.ray_trace?.counts[kind] || 0}</small></button>)}</div><div className="ray-plot-wrap"><div className="degree-scale" aria-label="Elevação de 0 a 10 graus">{Array.from({ length: 11 }, (_, degree) => <span key={degree}>{degree}°</span>)}</div><Plot className="ray-chart" data={data} layout={{ autosize: true, margin: { l: 62, r: 100, t: 42, b: 54 }, title: { text: 'RAY TRACE OVER TERRAIN', font: { size: 13, color: '#7dff9b' } }, paper_bgcolor: 'transparent', plot_bgcolor: 'transparent', font: { color: '#9aabb5', family: 'Inter, sans-serif' }, xaxis: { title: 'Distância (km)', range: [0, axisEnd / 1000], dtick: .5, gridcolor: '#263943' }, yaxis: { title: 'Altura (m)', range: [Math.max(0, Math.min(...terrain) - 30), 1000], dtick: 100, gridcolor: '#263943' }, yaxis2: { title: 'Elevação (°)', overlaying: 'y', anchor: 'x', side: 'right', range: [0, 10], tickmode: 'linear', dtick: 1, ticksuffix: '°', showticklabels: false, showline: false, showgrid: false, zeroline: false, ticks: '' }, legend: { orientation: 'h' as const, y: -.15 } }} config={{ responsive: true, displaylogo: false }} useResizeHandler style={{ width: '100%', height: '100%' }} /></div></article>
}

const helpItems = [
  ['Perfil .PRO', 'Arquivo com as distâncias e altitudes do terreno entre a estação e o horizonte analisado. Ele é a base geométrica do cálculo.'],
  ['Estatística de elevação (.PRN)', 'Arquivo com a distribuição percentual dos ângulos de chegada dos sinais para cada banda. A coluna compatível com a frequência selecionada aparece como barras no gráfico e é usada para calcular o Figure of Merit.'],
  ['Frequência', 'Informe a banda, como 20m, ou a frequência em MHz, como 14.2. A frequência altera o comprimento de onda, a reflexão no solo e a difração.'],
  ['Unidade', 'Unidade usada nos campos de altura e deslocamento da torre. Escolha metros ou pés; a conversão interna para o núcleo Fortran é automática.'],
  ['Alturas da antena', 'Altura de cada elemento da antena em relação ao terreno. Separe elementos por espaço. Um asterisco após a altura indica fase invertida, por exemplo 10*.'],
  ['Tipo de antena', 'Modelo de antena usado pelo OpenHFTA: dipolo ou conjunto direcional de 2, 3, 4, 5, 6 ou 8 elementos. Isso muda o padrão de elevação calculado.'],
  ['Permissividade do solo', 'Capacidade relativa do solo de armazenar energia elétrica. É usada no cálculo da reflexão do sinal. O valor padrão 13 é uma aproximação comum.'],
  ['Condutividade (S/m)', 'Capacidade do solo de conduzir corrente. Solos mais condutivos normalmente refletem o sinal de forma diferente. O valor padrão é 0.005 S/m.'],
  ['Deslocamento da torre', 'Move o ponto inicial da torre para trás no perfil, usando a unidade escolhida. Use para testar outra posição da estação no mesmo terreno.'],
  ['Incluir difração', 'Mantém habilitado o efeito do terreno sobre a propagação HF. Em geral, deixe ligado; desative apenas para comparar a influência da difração.'],
  ['Comparar cenários e azimutes', 'Executa de dois a quatro cenários. Você pode reutilizar um perfil para comparar antenas e alturas, ou selecionar até quatro arquivos .PRO para representar azimutes diferentes.'],
  ['RMSE', 'Erro quadrático médio da raiz entre duas curvas, em dB. Ele resume a diferença média entre os padrões em todos os ângulos: quanto menor o RMSE, mais parecidas são as curvas. Não indica sozinho qual cenário é melhor.'],
  ['Maior diferença', 'Maior diferença absoluta encontrada entre as duas curvas em qualquer ângulo de elevação. Mostra o pior afastamento pontual entre os cenários, em dB.'],
  ['Diferença de pico', 'Diferença entre os maiores ganhos dos dois cenários, em dB. Valor positivo indica que o cenário comparado tem pico maior que o cenário A; valor negativo indica pico menor.'],
  ['Dif. média integrada', 'Diferença entre os ganhos médios integrados ao longo de toda a faixa angular analisada, em dB. Ajuda a comparar o desempenho geral, não apenas o pico.'],
  ['Pico do padrão', 'Maior ganho encontrado na curva de elevação, informado em dB. Representa o ponto de melhor resposta da antena no perfil analisado.'],
  ['Ângulo do pico', 'Ângulo de elevação em que ocorre o maior ganho do padrão. Ângulos baixos normalmente favorecem contatos de longa distância em HF.'],
  ['Média integrada', 'Média do ganho calculada ao longo de toda a faixa de ângulos analisada. Resume o desempenho geral da curva, e não somente seu maior valor.'],
  ['Largura −3 dB', 'Largura angular do feixe principal medida 3 dB abaixo do pico. Feixe mais estreito indica maior concentração de energia em uma faixa menor de ângulos.'],
  ['Pontos do perfil', 'Quantidade de pontos de distância e altitude efetivamente usados no cálculo e exibidos no gráfico do terreno.'],
  ['Figure of Merit', 'Métrica ponderada pelo arquivo .PRN de estatística de elevação. Combina o ganho da antena com a probabilidade dos ângulos de chegada; quanto maior, melhor a adequação ao cenário estatístico.'],
]

const API_URL = import.meta.env.VITE_API_URL || (
  ['5173', '5174'].includes(window.location.port)
    ? `${window.location.protocol}//${window.location.hostname}:8000`
    : window.location.origin
)
const DEFAULT_PRN_OPTIONS = [
  'PT9-AF.PRN', 'PT9-AS.PRN', 'PT9-BR.PRN', 'PT9-BR-CO.PRN', 'PT9-BR-N.PRN', 'PT9-BR-NE.PRN', 'PT9-BR-S.PRN', 'PT9-BR-SE.PRN', 'PT9-EU.PRN', 'PT9-JA.PRN', 'PT9-OC.PRN', 'PT9-SA.PRN', 'PT9-US.PRN',
  'PY1-AF.PRN', 'PY1-AS.PRN', 'PY1-EU.PRN', 'PY1-JA.PRN', 'PY1-OC.PRN', 'PY1-SA.PRN', 'PY1-US.PRN',
  'PY5-AF.PRN', 'PY5-AS.PRN', 'PY5-JA.PRN', 'PY5-OC.PRN', 'PY5-SA.PRN', 'PY5-US.PRN',
]

function App() {
  const [files, setFiles] = useState<File[]>([])
  const [aoaFile, setAoaFile] = useState<File | null>(null)
  const [prnOptions, setPrnOptions] = useState<string[]>([])
  const [selectedPrn, setSelectedPrn] = useState('')
  const [frequency, setFrequency] = useState('20m')
  const [units, setUnits] = useState('meters')
  const [heights, setHeights] = useState('10')
  const [antennaType, setAntennaType] = useState('Dipole')
  const [soilEpsr, setSoilEpsr] = useState('13')
  const [soilSigma, setSoilSigma] = useState('0.005')
  const [moveTower, setMoveTower] = useState('0')
  const [noDiffraction, setNoDiffraction] = useState(false)
  const [compareMode, setCompareMode] = useState(false)
  const [scenarioConfigs, setScenarioConfigs] = useState<ScenarioConfig[]>([
    { name: 'Cenário A', heights: '10', antenna_type: 'Dipole' },
    { name: 'Cenário B', heights: '10', antenna_type: 'Dipole' },
  ])
  const [result, setResult] = useState<Result | null>(null)
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiExplanation, setAiExplanation] = useState<AIExplanation | null>(null)
  const [aiError, setAiError] = useState('')
  const [showHelp, setShowHelp] = useState(false)
  const [colorblindMode, setColorblindMode] = useState(() => window.localStorage.getItem('openhfta-colorblind-mode') === 'true')
  const [accessiblePatterns, setAccessiblePatterns] = useState(() => window.localStorage.getItem('openhfta-accessible-patterns') === 'true')
  const [rayKinds, setRayKinds] = useState<Record<string, boolean>>({ direct: true, reflected: true, diffracted: true, double_diffracted: true })
  const file = files[0] || null
  const profilePointCount = (profile?: Result['profile']) => profile
    ? Math.min(profile.points, profile.distances_m.length, profile.heights_m.length)
    : 0
  const antennaTypes = ['Dipole', '2-Ele', '3-Ele', '4-Ele', '5-Ele', '6-Ele', '8-Ele']

  function updateScenario(index: number, patch: Partial<ScenarioConfig>) {
    setScenarioConfigs(current => current.map((scenario, scenarioIndex) => scenarioIndex === index ? { ...scenario, ...patch } : scenario))
  }

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) { if (event.key === 'Escape') setShowHelp(false) }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [])

  useEffect(() => { window.localStorage.setItem('openhfta-colorblind-mode', String(colorblindMode)) }, [colorblindMode])
  useEffect(() => { window.localStorage.setItem('openhfta-accessible-patterns', String(accessiblePatterns)) }, [accessiblePatterns])

  useEffect(() => {
    fetch(`${API_URL}/api/prns`).then(response => response.ok ? response.json() : { files: [] }).then(payload => setPrnOptions(payload.files?.length ? payload.files : DEFAULT_PRN_OPTIONS)).catch(() => setPrnOptions(DEFAULT_PRN_OPTIONS))
  }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (!file) { setError('Selecione um arquivo .PRO antes de analisar.'); return }
    if (!aoaFile && !selectedPrn) { setError('Envie um arquivo .PRN próprio ou selecione um PRN padrão do projeto.'); return }
    setLoading(true)
    const form = new FormData()
    if (compareMode) {
      files.forEach(selectedFile => form.append('profiles', selectedFile))
      form.append('scenario_configs', JSON.stringify(scenarioConfigs.map((scenario, index) => ({ ...scenario, name: scenario.name || `Cenário ${String.fromCharCode(65 + index)}` }))))
    } else form.append('profile', file)
    if (aoaFile) form.append('aoa_file', aoaFile)
    if (selectedPrn) form.append('aoa_default', selectedPrn)
    form.append('frequency', frequency)
    form.append('units', units)
    form.append('heights', heights)
    form.append('antenna_type', antennaType)
    form.append('soil_epsr', soilEpsr)
    form.append('soil_sigma', soilSigma)
    form.append('move_tower', moveTower)
    form.append('no_diffraction', String(noDiffraction))
    try {
      const response = await fetch(`${API_URL}${compareMode ? '/api/compare' : '/api/analyze'}`, { method: 'POST', body: form })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.detail || 'Não foi possível executar a análise.')
      if (compareMode) { setCompareResult(payload); setResult(null) } else { setResult(payload); setCompareResult(null) }
      setAiExplanation(null); setAiError('')
    } catch (cause) {
      setError(cause instanceof TypeError ? `Não foi possível conectar à API em ${API_URL}. Inicie o backend na porta 8000.` : cause instanceof Error ? cause.message : 'Erro de comunicação com a API.')
    } finally { setLoading(false) }
  }

  async function askAI() {
    const analysis = compareResult || result
    if (!analysis) return
    const singleResult = result
    const compactScenario = (scenario: Scenario) => ({
      name: scenario.name,
      profile_name: scenario.profile_name,
      metrics: scenario.metrics,
      terrain: scenario.profile?.terrain,
      configuration: scenario.configuration,
      interpretation: scenario.interpretation,
      ray_trace: summarizeRayTrace(scenario.ray_trace),
    })
    const analysisForAI = compareResult
      ? {
          comparison: compareResult.comparison,
          limitations: compareResult.limitations,
          scenarios: compareResult.scenarios.map(compactScenario),
          terrain_profiles: compareResult.scenarios.map(scenario => ({
            scenario: scenario.name,
            profile_name: scenario.profile_name,
            profile: scenario.profile,
          })),
          scenario_summary: compareResult.scenarios.map(scenario => ({
            name: scenario.name,
            profile_name: scenario.profile_name,
            metrics: scenario.metrics,
            terrain: scenario.profile?.terrain,
            configuration: scenario.configuration,
            interpretation: scenario.interpretation,
            ray_trace: summarizeRayTrace(scenario.ray_trace),
          })),
        }
      : {
          metrics: singleResult?.metrics,
          profile: singleResult?.profile,
          configuration: singleResult?.configuration,
          interpretation: singleResult?.interpretation,
          limitations: singleResult?.limitations,
          ray_trace: summarizeRayTrace(singleResult?.ray_trace),
          terrain_profile: singleResult?.profile,
        }
    setAiLoading(true); setAiError('')
    try {
      const response = await fetch(`${API_URL}/api/ai/explain`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ analysis: analysisForAI }) })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.detail || 'Não foi possível obter a explicação da IA.')
      setAiExplanation(payload)
    } catch (cause) { setAiError(cause instanceof Error ? cause.message : 'Falha ao consultar a IA.') }
    finally { setAiLoading(false) }
  }

  async function exportResult(format: string) {
    if (!file) return
    if (!aoaFile && !selectedPrn) { setError('Envie um arquivo .PRN próprio ou selecione um PRN padrão do projeto.'); return }
    const form = new FormData()
    form.append('profile', file); form.append('frequency', frequency); form.append('units', units)
    form.append('heights', heights); form.append('antenna_type', antennaType); form.append('soil_epsr', soilEpsr)
    form.append('soil_sigma', soilSigma); form.append('move_tower', moveTower)
    form.append('no_diffraction', String(noDiffraction)); form.append('export_format', format)
    if (aoaFile) form.append('aoa_file', aoaFile)
    if (selectedPrn) form.append('aoa_default', selectedPrn)
    let response: Response
    try { response = await fetch(`${API_URL}/api/analyze`, { method: 'POST', body: form }) }
    catch { setError(`Não foi possível conectar à API em ${API_URL}.`); return }
    if (!response.ok) { setError('Não foi possível gerar a exportação.'); return }
    const blob = await response.blob(); const link = document.createElement('a')
    link.href = URL.createObjectURL(blob); link.download = `openhfta-pattern.${format}`; link.click(); URL.revokeObjectURL(link.href)
  }

  const peak = result ? Math.max(...result.pattern_db) : null
  const peakAngle = result && peak !== null ? result.angles_deg[result.pattern_db.indexOf(peak)] : null
  const palette = colorblindMode ? COLORBLIND_PALETTE : DEFAULT_PALETTE
  const aoaTrace = (aoa: Result['aoa']) => aoa && aoa.available !== false && aoa.angles_deg.length ? { x: aoa.angles_deg, y: aoa.probabilities_pct, type: 'bar' as const, name: `Estatística ${aoa.band || ''}`.trim(), yaxis: 'y2' as const, width: 0.72, marker: { color: palette.aoa, opacity: 0.35, line: { color: palette.aoa, width: 0.7 } }, hovertemplate: '%{x}°<br>%{y:.1f}%<extra></extra>' } : null
  const resultPatternData: any[] = result ? [
    { x: result.angles_deg, y: result.pattern_db, type: 'scatter', mode: accessiblePatterns ? 'lines+markers' : 'lines', name: 'Terreno', line: { color: palette.scenarios[0], width: 2.5 }, marker: { symbol: 'circle', size: 5, color: palette.scenarios[0] }, fill: 'tozeroy', fillcolor: `${palette.scenarios[0]}22`, hovertemplate: '%{x:.2f}°<br>%{y:.2f} dB<extra></extra>' },
    ...(result.flat_pattern_db ? [{ x: result.angles_deg, y: result.flat_pattern_db, type: 'scatter', mode: accessiblePatterns ? 'lines+markers' : 'lines', name: 'FLAT.PRO', line: { color: palette.flat, width: 2, dash: accessiblePatterns ? 'dash' : 'solid' }, marker: { symbol: 'x', size: 5, color: palette.flat }, hovertemplate: '%{x:.2f}°<br>%{y:.2f} dB<extra></extra>' }] : []),
    ...(result.aoa ? [aoaTrace(result.aoa)] : []),
  ].filter(Boolean) : []
  const comparePatternData: any[] = compareResult ? [
    ...compareResult.scenarios.flatMap((scenario, index) => [
      { x: compareResult.angles_deg, y: scenario.pattern_db, type: 'scatter', mode: accessiblePatterns ? 'lines+markers' : 'lines', name: scenario.name, line: { color: palette.scenarios[index % 4], width: 2.5, dash: accessiblePatterns ? SCENARIO_DASHES[index % 4] : 'solid' }, marker: { symbol: SCENARIO_SYMBOLS[index % 4], size: 5, color: palette.scenarios[index % 4] }, hovertemplate: '%{x:.2f}°<br>%{y:.2f} dB<extra></extra>' },
      ...(scenario.flat_pattern_db ? [{ x: compareResult.angles_deg, y: scenario.flat_pattern_db, type: 'scatter', mode: accessiblePatterns ? 'lines+markers' : 'lines', name: `${scenario.name} · FLAT.PRO`, line: { color: palette.scenarios[index % 4], width: 1.5, dash: 'dot' }, marker: { symbol: 'x', size: 5, color: palette.scenarios[index % 4] }, hovertemplate: '%{x:.2f}°<br>%{y:.2f} dB<extra></extra>' }] : []),
    ]),
    ...(compareResult.scenarios[0]?.aoa ? [aoaTrace(compareResult.scenarios[0].aoa)] : []),
  ].filter(Boolean) : []
  const patternLayout = { autosize: true, margin: { l: 48, r: 70, t: 20, b: 42 }, paper_bgcolor: 'transparent', plot_bgcolor: 'transparent', barmode: 'overlay' as const, font: { color: '#9aabb5', family: 'Inter, sans-serif' }, xaxis: { title: 'Elevação (°)', range: [0, 36], tick0: 0, gridcolor: '#263943', zeroline: false, dtick: 1, nticks: 37 }, yaxis: { title: 'Ganho (dB)', range: [-10, 20], gridcolor: '#263943', zeroline: false, dtick: 1, nticks: 31 }, yaxis2: { title: 'Estatística de elevação (%)', overlaying: 'y', side: 'right', range: [0, 20], dtick: 5, showgrid: false }, hovermode: 'x unified' }
  const rayLabels: Record<string, string> = { direct: 'Direto', reflected: 'Reflexão', diffracted: 'Difração', double_diffracted: 'Difração dupla' }
  const rayColors = palette.rays
  const traceSource = result || compareResult?.scenarios[0] || null
  const terrainDistances = traceSource?.profile?.distances_m?.slice(0, profilePointCount(traceSource?.profile)) || []
  const terrainHeights = traceSource?.profile?.heights_m?.slice(0, profilePointCount(traceSource?.profile)) || []
  const terrainOrigin = terrainHeights[0] || 0
  const relativeTerrainHeights = terrainHeights.map(height => height - terrainOrigin)
  const terrainYMin = relativeTerrainHeights.length ? Math.min(...relativeTerrainHeights) : -10
  const terrainAbsMin = terrainHeights.length ? Math.min(...terrainHeights) : 0
  const terrainAbsMax = terrainHeights.length ? Math.max(...terrainHeights) : 100
  const rayYMin = Math.max(0, terrainAbsMin - 30)
  const rayYMax = 1000
  const terrainEnd = terrainDistances.length ? terrainDistances[terrainDistances.length - 1] : 0
  const rayAxisEnd = Math.max(500, Math.ceil(terrainEnd / 500) * 500)
  const terrainAt = (distance: number) => {
    if (!terrainDistances.length) return 0
    for (let index = 1; index < terrainDistances.length; index += 1) {
      if (distance <= terrainDistances[index]) {
        const x0 = terrainDistances[index - 1]; const x1 = terrainDistances[index]
        const ratio = x1 === x0 ? 0 : (distance - x0) / (x1 - x0)
        return terrainHeights[index - 1] + (terrainHeights[index] - terrainHeights[index - 1]) * ratio
      }
    }
    return terrainHeights[terrainHeights.length - 1] || 0
  }
  const clipRay = (path: NonNullable<Result['ray_trace']>['paths'][number]) => {
    const points: Array<[number, number]> = []
    path.distances_m.forEach((distance, index) => {
      if (distance <= terrainEnd && path.heights_m[index] !== undefined) points.push([distance, path.heights_m[index]])
    })
    const crossing = path.distances_m.findIndex(distance => distance > terrainEnd)
    if (crossing > 0 && points.length && path.distances_m[crossing - 1] < terrainEnd) {
      const x0 = path.distances_m[crossing - 1]; const x1 = path.distances_m[crossing]
      const y0 = path.heights_m[crossing - 1]; const y1 = path.heights_m[crossing]
      const ratio = x1 === x0 ? 0 : (terrainEnd - x0) / (x1 - x0)
      points.push([terrainEnd, y0 + (y1 - y0) * ratio])
    }
    return points
  }
  const rayDisplayLimits: Record<string, number> = { direct: 1000, reflected: 1000, diffracted: 1000, double_diffracted: 1000 }
  const selectedRayPaths = Object.keys(rayDisplayLimits).flatMap(kind => {
    const antennaPattern = traceSource?.flat_pattern_db || traceSource?.pattern_db || []
    const paths = [...(traceSource?.ray_trace?.paths.filter(path => path.kind === kind && rayKinds[path.kind] !== false && fitsRayFrame(path, terrainEnd)) || [])].sort((a, b) => gainAt(traceSource?.angles_deg || [], antennaPattern, b.angle_deg) - gainAt(traceSource?.angles_deg || [], antennaPattern, a.angle_deg)).slice(0, rayDisplayLimits[kind]).sort((a, b) => a.angle_deg - b.angle_deg)
    const limit = rayDisplayLimits[kind]
    return paths.slice(0, limit)
  })
  const visibleRays = selectedRayPaths.map(path => ({ path, points: clipRay(path) })).filter(item => item.points.length >= 2 && (item.path.kind !== 'double_diffracted' || item.points.some(([distance, height]) => Math.abs(height - terrainAt(distance)) < 4)))
  const rayInteractions = visibleRays.flatMap(({ path, points }) => points.filter(([distance, height]) => Math.abs(height - terrainAt(distance)) < 4).map(([distance, height]) => ({ distance, height, kind: path.kind })))
  const rayCorners = visibleRays.flatMap(({ path, points }) => points.slice(1, -1).flatMap((point, index) => {
    const previous = points[index]; const next = points[index + 2]
    const incoming = Math.atan2(point[1] - previous[1], point[0] - previous[0])
    const outgoing = Math.atan2(next[1] - point[1], next[0] - point[0])
    const turnDegrees = Math.abs(outgoing - incoming) * 180 / Math.PI
    const nearTerrain = Math.abs(point[1] - terrainAt(point[0])) < 4
    return turnDegrees > 2 && turnDegrees < 170 && nearTerrain ? [{ distance: point[0], height: point[1], kind: path.kind }] : []
  }))
  const rayAntennaPattern = result?.flat_pattern_db || result?.pattern_db || []
  const rayGains = visibleRays.map(({ path }) => gainAt(result?.angles_deg || [], rayAntennaPattern, path.angle_deg))
  const rayLowGain = Math.min(...rayGains, 0); const rayHighGain = Math.max(...rayGains, 1)
  const rayTraceData: any[] = [
    ...visibleRays.map(({ path }, index) => {
      const points = clipRay(path)
      const gain = rayGains[index]; const weight = rayHighGain === rayLowGain ? .45 : .14 + .38 * ((gain - rayLowGain) / (rayHighGain - rayLowGain))
      return { x: points.map(point => point[0] / 1000), y: points.map(point => point[1]), type: 'scatter', mode: 'lines', name: rayLabels[path.kind] || path.kind, legendgroup: path.kind, showlegend: visibleRays.findIndex(candidate => candidate.path.kind === path.kind) === index, line: { color: rayColors[path.kind] || '#78b7d9', width: (path.kind === 'direct' ? 1.05 : .65) + weight, opacity: weight, dash: accessiblePatterns ? RAY_DASHES[path.kind] : 'solid' }, hovertemplate: `${rayLabels[path.kind] || path.kind}<br>saída: ${path.angle_deg.toFixed(2)}°<br>ganho da antena: ${gain.toFixed(1)} dB<br>%{x:.2f} km · %{y:.1f} m<extra></extra>` }
    }),
    { x: rayInteractions.map(point => point.distance / 1000), y: rayInteractions.map(point => point.height), type: 'scatter', mode: 'markers', name: 'Ponto no terreno', legendgroup: 'events', marker: { color: palette.event, size: 7, symbol: 'diamond', line: { color: '#081923', width: 1 } }, hovertemplate: 'Ponto de reflexão/difração<br>%{x:.2f} km · %{y:.1f} m<extra></extra>' },
    { x: rayCorners.map(point => point.distance / 1000), y: rayCorners.map(point => point.height), type: 'scatter', mode: 'markers', name: 'Mudança de direção', legendgroup: 'corners', marker: { color: palette.corner, size: 8, symbol: 'triangle-down', line: { color: '#fff1dc', width: 1 } }, hovertemplate: 'Mudança de direção<br>%{x:.2f} km · %{y:.1f} m<extra></extra>' },
    { x: [0], y: [terrainHeights[0] !== undefined ? terrainHeights[0] + (traceSource?.configuration?.antenna_heights_m?.[0] || 0) : 0], type: 'scatter', mode: 'markers', name: 'Antena', legendgroup: 'antenna', marker: { color: palette.antenna, size: 9, symbol: 'triangle-up' }, hovertemplate: 'Antena<br>%{y:.1f} m<extra></extra>' },
    { x: terrainDistances.map(distance => distance / 1000), y: terrainHeights, type: 'scatter', mode: 'lines+markers', name: 'TERRENO', legendgroup: 'terrain', line: { color: '#171717', width: 2 }, marker: { color: '#111111', size: 4, symbol: 'diamond' }, fill: 'tozeroy', fillcolor: 'rgba(194, 174, 162, .42)', hovertemplate: 'TERRENO<br>%{x:.2f} km · %{y:.1f} m<extra></extra>' },
    { x: [0, terrainEnd / 1000], y: [0, 10], yaxis: 'y2', type: 'scatter', mode: 'lines', line: { color: 'transparent', width: 0 }, opacity: 0, showlegend: false, hoverinfo: 'skip' },
  ]
  const rayTraceLayout = { autosize: true, margin: { l: 62, r: 100, t: 42, b: 54 }, title: { text: 'RAY TRACE OVER TERRAIN · FOCO NO RELEVO', font: { size: 13, color: '#7dff9b' } }, paper_bgcolor: 'transparent', plot_bgcolor: 'transparent', font: { color: '#9aabb5', family: 'Inter, sans-serif' }, xaxis: { title: 'Distância (km)', range: [0, rayAxisEnd / 1000], dtick: .5, gridcolor: '#263943', zeroline: false }, yaxis: { title: 'Altura (m)', range: [rayYMin, rayYMax], dtick: 100, gridcolor: '#263943', zeroline: false }, yaxis2: { title: 'Elevação (°)', overlaying: 'y', anchor: 'x', side: 'right', range: [0, 10], tickmode: 'linear', dtick: 1, ticksuffix: '°', showticklabels: true, showline: true, ticks: 'outside', tickfont: { color: '#c7d4d7', size: 11 }, titlefont: { color: '#c7d4d7', size: 12 }, gridcolor: 'transparent', zeroline: false }, legend: { orientation: 'h' as const, y: -0.2 }, hovermode: 'closest' as const }

  return <main className="shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">↗</span><span>Open<span>HFTA</span></span></div>
      <div className="topbar-actions"><button type="button" className={colorblindMode ? 'accessibility-toggle active' : 'accessibility-toggle'} onClick={() => setColorblindMode(current => !current)} aria-pressed={colorblindMode} title="Alternar paleta acessível para daltonismo">{colorblindMode ? '◉' : '○'} Cores acessíveis</button><button type="button" className={accessiblePatterns ? 'accessibility-toggle active' : 'accessibility-toggle'} onClick={() => setAccessiblePatterns(current => !current)} aria-pressed={accessiblePatterns} title="Alternar linhas e símbolos acessíveis">{accessiblePatterns ? '◉' : '○'} Linhas e símbolos</button><div className="status"><i /> núcleo Fortran online</div></div>
    </header>

    <section className="intro">
      <div className="intro-copy">
        <p className="eyebrow">HF TERRAIN ANALYSIS</p>
        <h1>Veja o terreno<br /><em>moldar o sinal.</em></h1>
        <p className="lede">Envie um perfil de terreno e explore o padrão de elevação da sua antena em segundos.</p>
      </div>
      <aside className="project-hero-credit">
        <small>PROJETO OPEN SOURCE</small>
        <strong>OpenHFTA<br /><em>HF Terrain Analysis</em></strong>
        <p>Projeto mantido pelo <a href="https://github.com/RioDXGroup" target="_blank" rel="noreferrer">Rio DX Group</a>.</p>
        <p><b>Desenvolvimento e contribuições técnicas:</b> <a href="https://www.qrz.com/db/PY2UID" target="_blank" rel="noreferrer">Paulo Matias — PY2UID</a> · <a href="https://github.com/thotypous" target="_blank" rel="noreferrer">GitHub ↗</a></p>
        <p>Radioamador, doutor pelo IFSC/USP, atua com Large Language Models na UFSCar e participa de competições de segurança da informação e CTF pela Epic Leet.</p>
        <a className="project-link" href="https://github.com/RioDXGroup/openhfta" target="_blank" rel="noreferrer">Projeto original no GitHub ↗</a>
        <p><b>Integração da versão web:</b> <a href="https://www.qrz.com/db/PT9TI" target="_blank" rel="noreferrer">Fernando Fernandes — PT9TI ↗</a></p>
        <p>Analista de sistemas e radioamador, responsável pela transformação do OpenHFTA em uma aplicação web moderna, com API, interface gráfica, análises comparativas, métricas e visualização dos resultados.</p>
      </aside>
    </section>

    <section className="workspace">
      <form className="panel controls" onSubmit={submit}>
        <div className="panel-heading"><span className="step">01</span><div><h2>Configuração</h2><p>Defina o cenário de análise</p></div><button type="button" className="help-button" onClick={() => setShowHelp(true)} aria-label="Explicar campos do formulário">?</button></div>
        <label className="file-drop">
          <input type="file" accept=".pro,.PRO" multiple onChange={event => {
            const selected = Array.from(event.target.files || [])
            const selectingMultiple = compareMode || files.length + selected.length > 1
            const nextFiles = selectingMultiple
              ? [...files, ...selected].filter((file, index, all) => all.findIndex(candidate => candidate.name === file.name && candidate.size === file.size && candidate.lastModified === file.lastModified) === index).slice(0, 4)
              : selected.slice(0, 1)
            setFiles(nextFiles)
            if (nextFiles.length > 1) {
              setCompareMode(true)
              setScenarioConfigs(current => {
              const next = [...current]
              while (next.length < nextFiles.length && next.length < 4) next.push({ name: `Cenário ${String.fromCharCode(65 + next.length)}`, heights: '10', antenna_type: 'Dipole' })
              return next.slice(0, Math.max(2, Math.min(4, nextFiles.length)))
              })
            }
            // Permite escolher novamente o mesmo arquivo em uma nova seleção.
            event.currentTarget.value = ''
          }} />
          <span className="upload-icon">↑</span>
          {files.length ? <div className="selected-files">{files.map((selectedFile, index) => <span className="selected-file" key={`${selectedFile.name}-${selectedFile.size}-${selectedFile.lastModified}`}><strong>{compareMode ? files.length === 1 ? `Todos os cenários · ${selectedFile.name}` : `Cenário ${String.fromCharCode(65 + index)} · ${selectedFile.name}` : selectedFile.name}</strong><button type="button" aria-label={`Remover ${selectedFile.name}`} onClick={event => { event.preventDefault(); event.stopPropagation(); setFiles(current => current.filter((_, fileIndex) => fileIndex !== index)) }}>×</button></span>)}</div> : <strong>Solte seu perfil .PRO aqui</strong>}
          <small>{files.length ? `${files.length} perfil(is) selecionado(s)` : compareMode ? 'selecione 1 perfil para todos ou até 4 perfis por azimute' : 'ou clique para procurar no computador'}</small>
        </label>

        <label className="aoa-upload"><input type="file" accept=".prn,.PRN" onChange={event => { const selected = event.target.files?.[0] || null; setAoaFile(selected); if (selected) setSelectedPrn('') }} /><span>Estatística de elevação (.PRN) — escolha uma opção</span><strong>{aoaFile ? aoaFile.name : 'Envie seu arquivo .PRN'}</strong></label>
        <div className="field-grid">
          <label>PRN padrão do projeto<select value={selectedPrn} onChange={event => { setSelectedPrn(event.target.value); if (event.target.value) setAoaFile(null) }}><option value="">Selecione um padrão</option>{prnOptions.map(name => <option key={name} value={name}>{name}</option>)}</select><small>{aoaFile ? 'O arquivo próprio foi selecionado; escolher um padrão o substitui.' : 'Ou escolha um padrão para exibir as barras e calcular o FOM.'}</small></label>
          <label>Frequência<input value={frequency} onChange={e => setFrequency(e.target.value)} placeholder="20m ou 14.2" /></label>
          <label>Unidade<select value={units} onChange={e => setUnits(e.target.value)}><option value="meters">Metros</option><option value="feet">Pés</option></select></label>
          <label className={compareMode ? 'field-disabled' : ''}>Alturas da antena<input disabled={compareMode} value={heights} onChange={e => setHeights(e.target.value)} placeholder="10 20*" /><small>{compareMode ? 'Use as alturas dos cenários A–D abaixo.' : 'Separe elementos por espaço; * = 180°'}</small></label>
          <label className={compareMode ? 'field-disabled' : ''}>Tipo de antena<select disabled={compareMode} value={antennaType} onChange={e => setAntennaType(e.target.value)}>{['Dipole','2-Ele','3-Ele','4-Ele','5-Ele','6-Ele','8-Ele'].map(type => <option key={type}>{type}</option>)}</select></label>
          <label>Permissividade do solo<input type="number" step="any" value={soilEpsr} onChange={e => setSoilEpsr(e.target.value)} /></label>
          <label>Condutividade (S/m)<input type="number" step="any" value={soilSigma} onChange={e => setSoilSigma(e.target.value)} /></label>
          <label>Deslocamento da torre<input type="number" step="any" value={moveTower} onChange={e => setMoveTower(e.target.value)} /></label>
        </div>
        <label className="toggle"><input type="checkbox" checked={!noDiffraction} onChange={e => setNoDiffraction(!e.target.checked)} /><span />Incluir difração no cálculo</label>
        <label className="toggle"><input type="checkbox" checked={compareMode} onChange={e => { setCompareMode(e.target.checked); if (!e.target.checked && files.length > 1) setFiles([files[0]]) }} /><span />Comparar cenários</label>
        {compareMode && <div className="scenario-editor"><div className="scenario-editor-title"><span>Até quatro cenários</span>{scenarioConfigs.length < 4 && <button type="button" onClick={() => setScenarioConfigs(current => [...current, { name: `Cenário ${String.fromCharCode(65 + current.length)}`, heights: '10', antenna_type: 'Dipole' }])}>+ adicionar</button>}</div><p className="scenario-help">Com vários arquivos: A usa o 1º `.PRO`, B o 2º, C o 3º e D o 4º. Com um arquivo, ele é usado em todos.</p>{scenarioConfigs.map((scenario, index) => <div className="scenario-row" key={index}><input aria-label={`Nome do cenário ${index + 1}`} value={scenario.name} onChange={event => updateScenario(index, { name: event.target.value })} placeholder={`Cenário ${String.fromCharCode(65 + index)}`} /><input aria-label={`Alturas do cenário ${index + 1}`} value={scenario.heights} onChange={event => updateScenario(index, { heights: event.target.value })} placeholder="10 20*" /><select aria-label={`Antena do cenário ${index + 1}`} value={scenario.antenna_type} onChange={event => updateScenario(index, { antenna_type: event.target.value })}>{antennaTypes.map(type => <option key={type}>{type}</option>)}</select>{scenarioConfigs.length > 2 && <button type="button" className="remove-scenario" onClick={() => setScenarioConfigs(current => current.filter((_, scenarioIndex) => scenarioIndex !== index))}>×</button>}</div>)}</div>}
        {error && <div className="error" role="alert">{error}</div>}
        <button className="submit" disabled={loading}>{loading ? 'Calculando...' : 'Executar análise'} <span>→</span></button>
      </form>

      <section className="panel results">
        <div className="panel-heading"><span className="step">02</span><div><h2>Resultado</h2><p>{compareResult ? 'Comparação calculada pelo núcleo' : result ? 'Padrão calculado pelo núcleo' : 'Aguardando uma análise'}</p></div></div>
        {loading && <div className="analysis-loading" role="status" aria-live="polite"><span className="loading-spinner" aria-hidden="true" /><div><strong>Processando análise…</strong><p>O núcleo Fortran está calculando o padrão, a difração e as trajetórias sobre o terreno.</p><small>Não feche esta página. O tempo depende do perfil e da quantidade de trajetórias.</small></div></div>}
        {compareResult ? <>
          <div className="comparison-pairs">{(compareResult.comparison.pairwise || [compareResult.comparison]).map((pair, index) => <article key={index}><div className="terrain-heading"><small>A × {String.fromCharCode(66 + index)}</small><span>Comparação com o cenário A</span></div><div className="metrics"><div><small>RMSE</small><strong>{pair.rmse_db.toFixed(2)} <b>dB</b></strong></div><div><small>MAIOR DIFERENÇA</small><strong>{pair.max_absolute_delta_db.toFixed(2)} <b>dB</b></strong></div><div><small>DIFERENÇA DE PICO</small><strong>{pair.peak_delta_db.toFixed(2)} <b>dB</b></strong></div><div><small>DIF. MÉDIA INTEGRADA</small><strong>{pair.integrated_average_delta_db.toFixed(2)} <b>dB</b></strong></div></div></article>)}</div>
          <div className="scenario-details">{compareResult.scenarios.map(scenario => <article key={scenario.name}><div className="terrain-heading"><small>{scenario.name.toUpperCase()}</small><span>{scenario.profile_name || 'Perfil compartilhado'}</span></div><div className="metrics"><div><small>PICO DO PADRÃO</small><strong>{scenario.metrics?.peak.value_db.toFixed(2)} <b>dB</b></strong></div><div><small>ÂNGULO DO PICO</small><strong>{scenario.metrics?.peak.angle_deg.toFixed(2)} <b>°</b></strong></div><div><small>MÉDIA INTEGRADA</small><strong>{scenario.metrics?.integrated_average_gain.average_db.toFixed(2)} <b>dB</b></strong></div><div><small>LARGURA −3 dB</small><strong>{scenario.metrics?.beamwidth_3db?.width_deg?.toFixed(2) ?? '—'} <b>°</b></strong></div><div><small>PONTOS DO PERFIL</small><strong>{scenario.profile ? profilePointCount(scenario.profile) : '—'}</strong></div><div><small>FIGURE OF MERIT</small><strong>{scenario.metrics?.figure_of_merit_db?.toFixed(2) ?? '—'} <b>dB</b></strong></div></div><div className="result-note">{scenario.configuration?.diffraction_disable ? 'Difração desativada' : 'Difração incluída'} · {scenario.configuration?.frequency_mhz?.toFixed(2)} MHz · {scenario.profile?.source_units || 'unidade não informada'} · {scenario.configuration?.antenna_heights_m?.map(height => height.toFixed(2)).join(' / ')} m</div></article>)}</div>
          <Plot className="chart" data={comparePatternData} layout={patternLayout} config={{ responsive: true, displaylogo: false }} useResizeHandler style={{ width: '100%', height: '300px' }} />
          <div className="scenario-averages">{compareResult.scenarios.map(scenario => <span key={scenario.name}><small>{scenario.name}</small><strong>{scenario.metrics?.integrated_average_gain.average_db.toFixed(2)} dB</strong></span>)}</div>
          <Plot className="terrain-chart" data={compareResult.scenarios.filter(scenario => scenario.profile).map((scenario, index) => ({ x: scenario.profile?.distances_m, y: scenario.profile?.heights_m, type: 'scatter' as const, mode: 'lines' as const, name: scenario.profile_name ? `${scenario.name} · ${scenario.profile_name}` : scenario.name, line: { color: palette.scenarios[index % 4], width: 2, dash: accessiblePatterns ? SCENARIO_DASHES[index % 4] : 'solid' } }))} layout={{ autosize: true, margin: { l: 48, r: 16, t: 12, b: 40 }, paper_bgcolor: 'transparent', plot_bgcolor: 'transparent', font: { color: '#9aabb5', family: 'Inter, sans-serif' }, xaxis: { title: 'Distância (m)', gridcolor: '#263943', nticks: 14 }, yaxis: { title: 'Altitude (m)', gridcolor: '#263943', nticks: 10 }, legend: { orientation: 'h' } }} config={{ responsive: true, displaylogo: false }} useResizeHandler style={{ width: '100%', height: '100%' }} />
          <div className="scenario-ray-list">{compareResult.scenarios.map((scenario, index) => <ScenarioRayTrace key={scenario.name} scenario={scenario} index={index} angles={compareResult.angles_deg} rayKinds={rayKinds} onToggle={kind => setRayKinds(current => ({ ...current, [kind]: !current[kind] }))} accessibleColors={colorblindMode} accessiblePatterns={accessiblePatterns} />)}</div>
          {compareResult.interpretation && <div className="interpretation"><small>LEITURA AUTOMÁTICA</small><strong>{compareResult.interpretation.headline}</strong><p>{compareResult.interpretation.beginner}</p><p className="technical">{compareResult.interpretation.technical}</p><ul>{compareResult.interpretation.observations.map((observation, index) => <li key={index}>{observation}</li>)}</ul></div>}
          {compareResult.limitations && <div className="limitations"><small>LIMITES DO MODELO</small>{compareResult.limitations.map((limitation, index) => <p key={index}>• {limitation}</p>)}</div>}
        </> : result ? <>
          <div className="metrics"><div><small>PICO DO PADRÃO</small><strong>{peak?.toFixed(2)} <b>dB</b></strong></div><div><small>ÂNGULO DO PICO</small><strong>{peakAngle?.toFixed(2)} <b>°</b></strong></div><div><small>MÉDIA INTEGRADA</small><strong>{result.metrics?.integrated_average_gain.average_db.toFixed(2)} <b>dB</b></strong></div><div><small>LARGURA −3 dB</small><strong>{result.metrics?.beamwidth_3db?.width_deg?.toFixed(2) ?? '—'} <b>°</b></strong></div><div><small>PONTOS DO PERFIL</small><strong>{profilePointCount(result.profile)}</strong></div><div><small>FIGURE OF MERIT</small><strong>{result.metrics?.figure_of_merit_db?.toFixed(2) ?? '—'} <b>dB</b></strong></div></div>
          {result.aoa?.message && <div className="aoa-status">{result.aoa.message}</div>}
          {result.aoa?.available && <div className="aoa-status">Estatística carregada: {result.aoa.band || 'banda compatível'} · {result.aoa.angles_deg.length} ângulos · {result.aoa.source || 'padrão do projeto'}</div>}
          <Plot className="chart" data={resultPatternData} layout={patternLayout} config={{ responsive: true, displaylogo: false }} useResizeHandler style={{ width: '100%', height: '300px' }} />
          <div className="terrain-heading"><small>PERFIL DO TERRENO</small><span>{profilePointCount(result.profile)} pontos · distância em metros</span></div>
          <Plot className="terrain-chart" data={[{ x: result.profile.distances_m.slice(0, profilePointCount(result.profile)), y: result.profile.heights_m.slice(0, profilePointCount(result.profile)), type: 'scatter', mode: 'lines', line: { color: '#6bd48b', width: 2 }, hovertemplate: '%{x:.0f} m<br>%{y:.1f} m<extra></extra>' }]} layout={{ autosize: true, margin: { l: 48, r: 16, t: 12, b: 40 }, paper_bgcolor: 'transparent', plot_bgcolor: 'transparent', font: { color: '#9aabb5', family: 'Inter, sans-serif' }, xaxis: { title: 'Distância (m)', gridcolor: '#263943', nticks: 14 }, yaxis: { title: 'Altitude (m)', gridcolor: '#263943', autorange: true, nticks: 10 } }} config={{ responsive: true, displaylogo: false }} useResizeHandler style={{ width: '100%', height: '100%' }} />
          {result.ray_trace?.available && <><div className="terrain-heading"><small>TRAÇADO DE RAIOS DO NÚCLEO</small><span>{visibleRays.length} trajetórias visíveis · {Object.values(result.ray_trace.counts).reduce((total, count) => total + count, 0)} calculadas</span></div><div className="ray-controls">{Object.entries(rayLabels).map(([kind, label]) => <button type="button" key={kind} className={rayKinds[kind] ? 'ray-toggle active' : 'ray-toggle'} onClick={() => setRayKinds(current => ({ ...current, [kind]: !current[kind] }))} style={{ '--ray-color': rayColors[kind] } as CSSProperties}><i />{label} <small>{result.ray_trace?.counts[kind] || 0}</small></button>)}</div><Plot className="ray-chart" data={rayTraceData} layout={rayTraceLayout} config={{ responsive: true, displaylogo: false }} useResizeHandler style={{ width: '100%', height: '100%' }} /></>}
          <div className="result-note">{result.configuration.diffraction_disable ? 'Difração desativada' : 'Difração incluída'} · reflexão e difração dupla do terreno · atmosfera não modelada · {result.configuration.frequency_mhz.toFixed(2)} MHz · {result.profile.source_units}</div>
          {result.interpretation && <div className="interpretation"><small>LEITURA AUTOMÁTICA</small><strong>{result.interpretation.headline}</strong><p>{result.interpretation.beginner}</p><p className="technical">{result.interpretation.technical}</p><ul>{result.interpretation.observations.map((observation, index) => <li key={index}>{observation}</li>)}</ul></div>}
          {result.limitations && <div className="limitations"><small>LIMITES DO MODELO</small>{result.limitations.map((limitation, index) => <p key={index}>• {limitation}</p>)}</div>}
          <div className="exports"><small>EXPORTAR</small>{['json', 'csv', 'png', 'svg', 'pdf'].map(format => <button key={format} type="button" onClick={() => exportResult(format)}>{format.toUpperCase()}</button>)}</div>
        </> : <div className="empty"><div className="empty-graphic"><span>⌁</span></div><strong>Seu padrão aparecerá aqui</strong><p>Preencha a configuração ao lado<br />e execute a primeira análise.</p></div>}
        {(result || compareResult) && <div className="ai-box"><button type="button" className="ai-button" onClick={askAI} disabled={aiLoading}>{aiLoading ? 'Interpretando...' : '✦ Explicar resultado com IA'}</button>{aiError && <p className="ai-error">{aiError}</p>}{aiExplanation && <div className="ai-answer"><small>OPINIÃO TÉCNICA · confiança {aiExplanation.confianca}</small><strong>{aiExplanation.headline}</strong><p>{aiExplanation.for_leigo}</p>{compareResult && <p><b>Cenários analisados:</b> {aiExplanation.cenarios_analisados.join(', ')}</p>}<b>Melhor cenário: {aiExplanation.melhor_cenario}</b><ul>{aiExplanation.por_que.map((reason, index) => <li key={index}>{reason}</li>)}</ul><b>Recomendações:</b><ul>{aiExplanation.recomendacoes.map((recommendation, index) => <li key={index}>{recommendation}</li>)}</ul><p className="technical">Cuidados: {aiExplanation.cuidados.join(' ')}</p></div>}</div>}
      </section>
    </section>
    {showHelp && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setShowHelp(false) }}>
      <section className="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title">
        <div className="help-modal-header"><div><p className="eyebrow">GUIA RÁPIDO</p><h2 id="help-title">O que significa cada campo?</h2></div><button type="button" className="modal-close" onClick={() => setShowHelp(false)} aria-label="Fechar explicações">×</button></div>
        <p className="help-intro">Esses parâmetros descrevem uma análise de padrão de elevação de uma antena HF sobre um perfil de terreno. O núcleo calcula em pés internamente, mas você pode informar e interpretar os valores em metros.</p>
        <div className="help-list">{helpItems.map(([title, description]) => <article key={title}><h3>{title}</h3><p>{description}</p></article>)}</div>
        <div className="help-tip"><strong>Dica para começar</strong><p>Use o perfil real, frequência da sua banda, altura medida da antena, difração ligada e os valores de solo padrão. Depois compare alturas ou tipos de antena para entender qual cenário favorece seu objetivo.</p></div>
      </section>
    </div>}
    <footer className="site-footer">
      <strong>OpenHFTA <span>·</span> preservando a inteligência do HFTA para sistemas modernos</strong>
      <small>Projeto mantido pelo Rio DX Group · Desenvolvimento técnico: <a href="https://www.qrz.com/db/PY2UID" target="_blank" rel="noreferrer">Paulo Matias — PY2UID ↗</a> · Integração web: Fernando Fernandes — <a href="https://www.qrz.com/db/PT9TI" target="_blank" rel="noreferrer">PT9TI ↗</a></small>
    </footer>
  </main>
}

export default App
