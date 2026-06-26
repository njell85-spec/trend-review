/**
 * Look up real DOI + PMCID for the 3 existing top papers from PubMed.
 */
import 'dotenv/config';
import { parseStringPromise } from 'xml2js';

const PMIDS = ['42228369', '42223936', '42230073'];
const EMAIL = process.env.PUBMED_EMAIL ?? 'research@example.com';
const API_KEY = process.env.PUBMED_API_KEY ?? '';

const params = new URLSearchParams({
  db: 'pubmed',
  id: PMIDS.join(','),
  rettype: 'abstract',
  retmode: 'xml',
  tool: 'LitReviewAgent',
  email: EMAIL,
  ...(API_KEY && { api_key: API_KEY }),
});

const res = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?${params}`);
const xmlText = await res.text();
const xml = await parseStringPromise(xmlText, { explicitArray: false, ignoreAttrs: false });

const set = xml?.PubmedArticleSet?.PubmedArticle;
const items = Array.isArray(set) ? set : [set];

for (const item of items) {
  const pmid = item?.MedlineCitation?.PMID?._ ?? item?.MedlineCitation?.PMID ?? '';
  const articleIds = item?.PubmedData?.ArticleIdList?.ArticleId;
  const idList = Array.isArray(articleIds) ? articleIds : articleIds ? [articleIds] : [];

  const doi   = idList.find(id => id?.$?.IdType === 'doi')?._   ?? '(none)';
  const pmcid = idList.find(id => id?.$?.IdType === 'pmc')?._   ?? '(none)';
  const mid   = idList.find(id => id?.$?.IdType === 'mid')?._   ?? '';

  console.log(`PMID ${pmid}:`);
  console.log(`  DOI   : ${doi}`);
  console.log(`  PMCID : ${pmcid}`);
  if (mid) console.log(`  MID   : ${mid}`);
  console.log();
}
