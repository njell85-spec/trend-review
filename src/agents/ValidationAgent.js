/**
 * ValidationAgent
 * MCP bindings: filesystem (read/write quality reports)
 *
 * Two-pass medical domain validation:
 *   Pass 1 (pre-analysis): filter incomplete papers before expensive Claude calls
 *   Pass 2 (post-analysis): verify PICO completeness and cross-check consistency
 */
import { Logger } from '../utils/Logger.js';

const EM_CCM_MESH_TERMS = new Set([
  'Emergency Medicine', 'Emergency Service, Hospital', 'Critical Care',
  'Intensive Care Units', 'Sepsis', 'Septic Shock', 'Shock, Septic',
  'Resuscitation', 'Cardiopulmonary Resuscitation', 'Heart Arrest',
  'Respiratory Insufficiency', 'Acute Kidney Injury', 'Multiple Organ Failure',
  'Airway Management', 'Intubation, Intratracheal', 'Fluid Therapy',
  'Mechanical Ventilation', 'Respiration, Artificial', 'Hemodynamics',
  'Vasopressors', 'Norepinephrine', 'Dopamine', 'Epinephrine',
  'Triage', 'Point-of-Care Testing', 'Ultrasound', 'Echocardiography',
  'Trauma', 'Wounds and Injuries', 'Burns', 'Poisoning',
  'Shock', 'Anaphylaxis', 'Stroke', 'Myocardial Infarction',
]);

const EM_CCM_KEYWORDS = [
  'emergency', 'critical care', 'intensive care', 'icu', 'sepsis',
  'septic shock', 'resuscitation', 'airway', 'intubation', 'ventilation',
  'hemodynamic', 'vasopressor', 'trauma', 'cardiac arrest', 'cpr',
  'triage', 'acute', 'shock', 'mortality', 'organ failure',
];

export class ValidationAgent {
  constructor(options = {}) {
    this.logger = new Logger('ValidationAgent', { logFile: 'validation.jsonl' });
    this.minAbstractLength = options.minAbstractLength ?? 100;
    this.minTitleLength = options.minTitleLength ?? 10;
    this.strictMode = options.strictMode ?? false;
  }

  // ── Pass 1: Pre-analysis paper validation ────────────────────────────────
  validatePaper(paper) {
    const issues = [];
    const warnings = [];

    // Required field checks
    if (!paper.pmid) issues.push('Missing PMID');
    if (!paper.title || paper.title.length < this.minTitleLength)
      issues.push(`Title too short (${paper.title?.length ?? 0} chars)`);
    if (!paper.abstract || paper.abstract.length < this.minAbstractLength)
      issues.push(`Abstract too short (${paper.abstract?.length ?? 0} chars)`);

    // EM/CCM relevance check
    const relevanceScore = this._computeRelevance(paper);
    if (relevanceScore === 0)
      warnings.push('No EM/CCM MeSH terms or keywords detected');
    else if (relevanceScore < 2)
      warnings.push('Low EM/CCM relevance signal');

    // Abstract quality checks
    if (paper.abstract && paper.abstract.length > 50) {
      const hasNumerics = /\d+(\.\d+)?%|\d+\/\d+|p\s*[<=>]\s*0\.\d+|OR|RR|HR|CI/i.test(paper.abstract);
      if (!hasNumerics) warnings.push('Abstract lacks quantitative results');
    }

    if (!paper.journal) warnings.push('Missing journal name');
    if (!paper.pubDate) warnings.push('Missing publication date');
    if (!paper.authors?.length) warnings.push('Missing authors');

    const qualityScore = this._computeQualityScore(paper, issues, warnings, relevanceScore);

    return {
      pmid: paper.pmid,
      valid: issues.length === 0,
      issues,
      warnings,
      qualityScore,
      relevanceScore,
      pass: 1,
    };
  }

  _computeRelevance(paper) {
    let score = 0;
    const textLower = `${paper.title} ${paper.abstract}`.toLowerCase();

    // MeSH term match (high weight)
    for (const mesh of paper.meshTerms ?? []) {
      if (EM_CCM_MESH_TERMS.has(mesh)) score += 2;
    }

    // Keyword match in text (lower weight)
    for (const kw of EM_CCM_KEYWORDS) {
      if (textLower.includes(kw)) score += 1;
    }

    return score;
  }

  _computeQualityScore(paper, issues, warnings, relevanceScore) {
    let score = 10;
    score -= issues.length * 3;
    score -= warnings.length * 1;
    score += Math.min(relevanceScore, 5);
    score += paper.abstract?.length > 300 ? 1 : 0;
    score += paper.meshTerms?.length > 3 ? 1 : 0;
    return Math.max(0, Math.min(10, score));
  }

  validatePapers(papers) {
    this.logger.section('ValidationAgent — Pass 1: Pre-analysis Filtering');
    const results = papers.map((p) => this.validatePaper(p));

    const valid = results.filter((r) => r.valid);
    const invalid = results.filter((r) => !r.valid);

    invalid.forEach((r) => {
      this.logger.warn(`PMID ${r.pmid} excluded`, { issues: r.issues });
    });

    this.logger.info(`Validation: ${valid.length}/${papers.length} papers passed`, {
      excluded: invalid.length,
      avgQuality: (valid.reduce((s, r) => s + r.qualityScore, 0) / (valid.length || 1)).toFixed(1),
    });

    const validPmids = new Set(valid.map((r) => r.pmid));
    return {
      papers: papers.filter((p) => validPmids.has(p.pmid)),
      validationResults: results,
      stats: {
        total: papers.length,
        valid: valid.length,
        excluded: invalid.length,
        avgQualityScore: parseFloat(
          (valid.reduce((s, r) => s + r.qualityScore, 0) / (valid.length || 1)).toFixed(1)
        ),
      },
    };
  }

  // ── Pass 2: Post-analysis PICO validation ────────────────────────────────
  validatePicoResults(picoResults) {
    this.logger.section('ValidationAgent — Pass 2: PICO Quality Assurance');
    const validated = picoResults.map((result) => this._validatePico(result));

    const passed = validated.filter((v) => v.picoQuality >= 6);
    this.logger.info(`PICO QA: ${passed.length}/${validated.length} results high quality`, {
      avgPicoQuality: (
        validated.reduce((s, v) => s + v.picoQuality, 0) / (validated.length || 1)
      ).toFixed(1),
    });

    return validated;
  }

  _validatePico(result) {
    const issues = [];
    const pico = result.pico ?? {};
    const checks = {
      population: { minLen: 20, label: 'Population' },
      intervention: { minLen: 15, label: 'Intervention' },
      comparison: { minLen: 5, label: 'Comparison' },
      outcome: { minLen: 20, label: 'Outcome' },
    };

    for (const [field, { minLen, label }] of Object.entries(checks)) {
      const val = pico[field] ?? '';
      if (val.length < minLen || val === 'Not analyzed')
        issues.push(`${label} PICO element incomplete`);
    }

    if (!result.clinicalTakeaway || result.clinicalTakeaway.length < 30)
      issues.push('Clinical takeaway too brief');
    if (!result.keyFindings?.length)
      issues.push('No key findings listed');
    if (!result.evidenceLevel)
      issues.push('Evidence level not specified');
    if (!result.limitations || result.limitations.length < 20)
      issues.push('Limitations not adequately described');

    // Score consistency check
    const scoreConsistent =
      !result.clinicalApplicabilityScore ||
      Math.abs(result.clinicalApplicabilityScore - (result.paper?.scoringData?.score ?? 0)) <= 3;
    if (!scoreConsistent)
      issues.push('Significant score inconsistency between passes');

    const picoQuality = Math.max(0, 10 - issues.length * 2);

    return {
      ...result,
      picoIssues: issues,
      picoQuality,
      picoValid: issues.length === 0,
    };
  }

  // ── Quality report ───────────────────────────────────────────────────────
  generateQualityReport(pass1Stats, pass2Results, allScoredPapers) {
    const scoreDistribution = { '1-3': 0, '4-6': 0, '7-8': 0, '9-10': 0 };
    for (const p of allScoredPapers) {
      const s = p.scoringData?.score ?? 0;
      if (s <= 3) scoreDistribution['1-3']++;
      else if (s <= 6) scoreDistribution['4-6']++;
      else if (s <= 8) scoreDistribution['7-8']++;
      else scoreDistribution['9-10']++;
    }

    const studyTypes = {};
    for (const p of allScoredPapers) {
      const t = p.scoringData?.studyType ?? 'Other';
      studyTypes[t] = (studyTypes[t] ?? 0) + 1;
    }

    return {
      generatedAt: new Date().toISOString(),
      pass1: pass1Stats,
      pass2: {
        analyzed: pass2Results.length,
        highQuality: pass2Results.filter((r) => r.picoQuality >= 8).length,
        acceptable: pass2Results.filter((r) => r.picoQuality >= 6).length,
        avgPicoQuality: parseFloat(
          (
            pass2Results.reduce((s, r) => s + r.picoQuality, 0) / (pass2Results.length || 1)
          ).toFixed(1)
        ),
      },
      scoreDistribution,
      studyTypeBreakdown: studyTypes,
    };
  }
}
