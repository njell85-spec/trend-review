# Trend Review - Daily Paper Fetch (Windows Task Scheduler)
# Runs at 06:30 KST, fetches EM/CCM papers, pushes to GitHub raw_papers.json
# Scheduled via: Register-ScheduledTask (see registration command in project notes)

$TOKEN = "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"
$OWNER = "njell85-spec"
$REPO  = "Trend_Review"

$today = Get-Date
$since = $today.AddDays(-180).ToString("yyyy-MM-dd")
$toDay = $today.ToString("yyyy-MM-dd")

$logFile = "$env:TEMP\trend_review_fetch_$(Get-Date -Format 'yyyyMMdd').log"
"[$(Get-Date -Format 'HH:mm:ss')] Starting fetch for $toDay" | Out-File $logFile -Append

try {
    $query = "(emergency+medicine+OR+emergency+department+OR+critical+care+OR+intensive+care+OR+resuscitation+OR+sepsis+OR+trauma)+AND+(src:MED)+AND+(FIRST_PDATE:[${since}+TO+${toDay}])"
    $url   = "https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=$query&resultType=core&pageSize=50&format=json&sort=P_PDATE_D+desc"
    $resp  = Invoke-RestMethod -Uri $url -TimeoutSec 30

    $papers = @()
    foreach ($r in $resp.resultList.result) {
        $pub = if ($r.firstPublicationDate) { $r.firstPublicationDate } else { "" }
        $yr  = if ($pub -match '^(\d{4})') { $Matches[1] } else { "" }
        $mo  = if ($pub -match '^\d{4}-(\d{2})') { [datetime]::ParseExact($Matches[1],"MM",$null).ToString("MMM") } else { "" }
        $papers += [ordered]@{
            pmid     = if ($r.pmid) { "$($r.pmid)" } else { "" }
            title    = if ($r.title) { ($r.title -replace '<[^>]+>','') } else { "" }
            authors  = if ($r.authorString) { $r.authorString } else { "" }
            journal  = if ($r.journalAbbreviation) { $r.journalAbbreviation } elseif ($r.journalTitle) { $r.journalTitle } else { "" }
            year     = $yr
            month    = $mo
            abstract = if ($r.abstractText) { ($r.abstractText -replace '<[^>]+>','') } else { "" }
            doi      = if ($r.doi) { $r.doi } else { "" }
            pubDate  = $pub
        }
    }

    $payload = [ordered]@{
        fetched_at = (Get-Date -Format "yyyy-MM-ddTHH:mm:ss")
        date       = $toDay
        papers     = $papers
    }
    $json = $payload | ConvertTo-Json -Depth 5 -Compress

    $existing = Invoke-RestMethod -Uri "https://api.github.com/repos/$OWNER/$REPO/contents/data/raw_papers.json" `
        -Headers @{Authorization="token $TOKEN"; Accept="application/vnd.github+json"}
    $encoded  = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($json))
    $body = @{message="Auto-fetch papers: $toDay"; content=$encoded; sha=$existing.sha} | ConvertTo-Json

    Invoke-RestMethod -Uri "https://api.github.com/repos/$OWNER/$REPO/contents/data/raw_papers.json" `
        -Method Put `
        -Headers @{Authorization="token $TOKEN"; Accept="application/vnd.github+json"; "Content-Type"="application/json"} `
        -Body $body | Out-Null

    "[$(Get-Date -Format 'HH:mm:ss')] SUCCESS — $($papers.Count) papers pushed to raw_papers.json" | Out-File $logFile -Append
} catch {
    "[$(Get-Date -Format 'HH:mm:ss')] ERROR: $_" | Out-File $logFile -Append
    exit 1
}
