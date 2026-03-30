param(
  [string]$BaseUrl = "http://localhost:3000",
  [string]$Model = "ollama:qwen2.5:3b",
  [string]$OutlineModel = "",
  [string]$ContentModel = "",
  [string]$ActionsModel = "",
  [string]$ApiKey = "",
  [string]$ProviderBaseUrl = "http://127.0.0.1:11434/v1",
  [string]$ProviderType = "openai",
  [switch]$RequiresApiKey,
  [string]$Prompt = "Teach photosynthesis to class 9 with examples",
  [string]$PromptFile = "",
  [string]$Language = "en-US",
  [switch]$ShowRawOutput,
  [switch]$DumpAllRawOutput,
  [string]$RawOutputFile = "",
  [switch]$ClearRawOutputFile,
  [switch]$SmokeTestOnly,
  [string]$SmokeQuestion = "Reply with exactly: OK"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Utf8NoBomFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [string]$Content
  )
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function ConvertTo-JsonCompat {
  param(
    [Parameter(Mandatory = $true)]
    $InputObject,
    [int]$Depth = 20,
    [switch]$Compress
  )
  $cmd = Get-Command ConvertTo-Json
  $hasDepth = $null -ne $cmd.Parameters["Depth"]
  if ($hasDepth) {
    if ($Compress) {
      return ($InputObject | ConvertTo-Json -Depth $Depth -Compress)
    }
    return ($InputObject | ConvertTo-Json -Depth $Depth)
  }
  if ($Compress) {
    return ($InputObject | ConvertTo-Json -Compress)
  }
  return ($InputObject | ConvertTo-Json)
}

function ConvertFrom-JsonCompat {
  param(
    [Parameter(Mandatory = $true)]
    [string]$InputText,
    [int]$Depth = 100
  )
  $cmd = Get-Command ConvertFrom-Json
  $hasDepth = $null -ne $cmd.Parameters["Depth"]
  if ($hasDepth) {
    return ($InputText | ConvertFrom-Json -Depth $Depth)
  }
  return ($InputText | ConvertFrom-Json)
}

if ([string]::IsNullOrWhiteSpace($RawOutputFile)) {
  $RawOutputFile = Join-Path -Path $PSScriptRoot -ChildPath "generation-raw-output.jsonl"
}
if ($ClearRawOutputFile -and (Test-Path -LiteralPath $RawOutputFile)) {
  try {
    Remove-Item -LiteralPath $RawOutputFile -Force
  } catch {
    try {
      Set-Content -LiteralPath $RawOutputFile -Value ""
    } catch {
      $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
      $fallback = Join-Path -Path $PSScriptRoot -ChildPath "generation-raw-output-$timestamp.jsonl"
      Write-Host "Warning: Could not clear locked log file. Using fallback log: $fallback" -ForegroundColor Yellow
      $RawOutputFile = $fallback
    }
  }
}

function Write-GenerationFailure {
  param(
    [string]$Message,
    [string]$PromptText,
    [string]$Stage,
    [string]$RawOutput = ""
  )

  Write-Host ""
  Write-Host "Generation failed" -ForegroundColor Red
  Write-Host $Message -ForegroundColor Red
  Write-Host ""
  Write-Host "generation.generationError" -ForegroundColor DarkRed
  Write-Host ""
  Write-Host $Message -ForegroundColor Red
  Write-Host ""
  Write-Host "Stage: $Stage" -ForegroundColor Yellow
  Write-Host "Prompt: $PromptText" -ForegroundColor Yellow

  if ($ShowRawOutput -and -not [string]::IsNullOrWhiteSpace($RawOutput)) {
    Write-Host ""
    Write-Host "=== Raw Output ===" -ForegroundColor Magenta
    Write-Host $RawOutput
  }

  if (-not [string]::IsNullOrWhiteSpace($RawOutputFile)) {
    $entryObj = @{
      timestamp = (Get-Date).ToString("o")
      stage = $Stage
      prompt = $PromptText
      message = $Message
      rawOutput = $RawOutput
    }
    $entry = ConvertTo-JsonCompat -InputObject $entryObj -Depth 20 -Compress

    Add-Content -Path $RawOutputFile -Value $entry
  }
}

function Write-RawTrace {
  param(
    [string]$Stage,
    [string]$PromptText,
    [string]$Status,
    [string]$RequestJson = "",
    [string]$RawOutput = ""
  )

  if ($DumpAllRawOutput) {
    Write-Host ""
    Write-Host "=== Raw Trace [$Stage][$Status] ===" -ForegroundColor Magenta
    if (-not [string]::IsNullOrWhiteSpace($RequestJson)) {
      Write-Host "--- Request ---" -ForegroundColor DarkMagenta
      Write-Host $RequestJson
    }
    if (-not [string]::IsNullOrWhiteSpace($RawOutput)) {
      Write-Host "--- Response ---" -ForegroundColor DarkMagenta
      Write-Host $RawOutput
    }
  }

  if (-not [string]::IsNullOrWhiteSpace($RawOutputFile)) {
    $entryObj = @{
      timestamp = (Get-Date).ToString("o")
      stage = $Stage
      status = $Status
      prompt = $PromptText
      request = $RequestJson
      rawOutput = $RawOutput
    }
    $entry = ConvertTo-JsonCompat -InputObject $entryObj -Depth 20 -Compress
    Add-Content -Path $RawOutputFile -Value $entry
  }
}

function Get-ModelIdFromModelString {
  param([string]$ModelString)
  $idx = $ModelString.IndexOf(":")
  if ($idx -lt 0) { return $ModelString }
  return $ModelString.Substring($idx + 1)
}

function New-HeaderArgs {
  $headerMap = [ordered]@{
    "Content-Type" = "application/json"
    "x-model" = $Model
    "x-outline-model" = $OutlineModel
    "x-content-model" = $ContentModel
    "x-actions-model" = $ActionsModel
    "x-api-key" = $ApiKey
    "x-base-url" = $ProviderBaseUrl
    "x-provider-type" = $ProviderType
    "x-requires-api-key" = $(if ($RequiresApiKey) { "true" } else { "false" })
    "x-image-generation-enabled" = "false"
    "x-video-generation-enabled" = "false"
  }

  $args = @()
  foreach ($entry in $headerMap.GetEnumerator()) {
    if ($null -ne $entry.Value) {
      $args += @("-H", "$($entry.Key): $($entry.Value)")
    }
  }
  return ,$args
}

function Invoke-CurlJson {
  param(
    [string]$Url,
    [hashtable]$Body,
    [switch]$IsSse
  )

  $tempFile = New-TemporaryFile
  try {
    $jsonBody = ConvertTo-JsonCompat -InputObject $Body -Depth 100
    Write-Utf8NoBomFile -Path $tempFile.FullName -Content $jsonBody
    $args = @("-sS")
    if ($IsSse) {
      $args += "-N"
    }
    $args += @("-X", "POST", $Url)
    $args += New-HeaderArgs
    $args += @("--data-binary", "@$($tempFile.FullName)")

    $output = & curl.exe @args 2>&1
    if ($LASTEXITCODE -ne 0) {
      if ($output -is [array]) {
        $output = ($output -join "`n")
      }
      throw "curl failed with exit code $LASTEXITCODE for $Url`n$output"
    }

    if ($output -is [array]) {
      return ($output -join "`n")
    }
    return [string]$output
  } finally {
    Remove-Item -LiteralPath $tempFile.FullName -ErrorAction SilentlyContinue
  }
}

function Invoke-SimpleLlmCheck {
  param([string]$Question)
  $modelId = Get-ModelIdFromModelString -ModelString $Model
  $url = "$ProviderBaseUrl/chat/completions"
  $body = @{
    model = $modelId
    stream = $false
    temperature = 0
    messages = @(
      @{
        role = "user"
        content = $Question
      }
    )
    max_tokens = 64
  }

  $tmp = New-TemporaryFile
  try {
    $bodyJson = ConvertTo-JsonCompat -InputObject $body -Depth 20
    Write-Utf8NoBomFile -Path $tmp.FullName -Content $bodyJson
    $args = @(
      "-sS",
      "-X", "POST", $url,
      "-H", "Content-Type: application/json",
      "--data-binary", "@$($tmp.FullName)"
    )
    if (-not [string]::IsNullOrWhiteSpace($ApiKey)) {
      $args += @("-H", "Authorization: Bearer $ApiKey")
    }

    $raw = & curl.exe @args 2>&1
    if ($LASTEXITCODE -ne 0) {
      if ($raw -is [array]) { $raw = ($raw -join "`n") }
      throw "curl failed with exit code $LASTEXITCODE for $url`n$raw"
    }
    if ($raw -is [array]) { $raw = ($raw -join "`n") }
    $raw = [string]$raw
    $requestJson = $bodyJson
    Write-RawTrace -Stage "smoke-test" -PromptText $Question -Status "ok" -RequestJson $requestJson -RawOutput $raw

    $json = ConvertFrom-JsonCompat -InputText $raw -Depth 100
    $hasErrorProp = $json.PSObject.Properties.Name -contains "error"
    if ($hasErrorProp -and $null -ne $json.error) {
      $errorObj = $json.error
      $msg = ""
      if ($errorObj -is [string]) {
        $msg = $errorObj
      } elseif ($errorObj.PSObject.Properties.Name -contains "message" -and $errorObj.message) {
        $msg = [string]$errorObj.message
      } else {
        $msg = [string]$errorObj
      }
      throw "Smoke test provider error: $msg"
    }

    $answer = ""
    if ($json.PSObject.Properties.Name -contains "choices" -and $json.choices -and $json.choices.Count -gt 0 -and $json.choices[0].message) {
      $answer = [string]$json.choices[0].message.content
    }
    if ([string]::IsNullOrWhiteSpace($answer)) {
      throw "Smoke test returned empty content"
    }
    return $answer
  } catch {
    Write-RawTrace -Stage "smoke-test" -PromptText $Question -Status "error" -RequestJson (ConvertTo-JsonCompat -InputObject $body -Depth 20) -RawOutput ($_.Exception.Message)
    throw
  } finally {
    Remove-Item -LiteralPath $tmp.FullName -ErrorAction SilentlyContinue
  }
}

function Parse-SseEvents {
  param([string]$RawSse)
  $events = @()
  $lines = $RawSse -split "`r?`n"

  foreach ($line in $lines) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    if ($line.StartsWith(":")) { continue }
    if (-not $line.StartsWith("data:")) { continue }

    $payload = $line.Substring(5).Trim()
    if ([string]::IsNullOrWhiteSpace($payload)) { continue }

    try {
      $events += ,(ConvertFrom-JsonCompat -InputText $payload -Depth 100)
    } catch {
      # Ignore malformed frame, keep processing other events.
    }
  }

  return ,$events
}

function Get-PromptList {
  if ($PromptFile -and (Test-Path -LiteralPath $PromptFile)) {
    return @(Get-Content -LiteralPath $PromptFile | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  }
  return @([string]$Prompt)
}

$prompts = @(Get-PromptList)
if ($prompts.Count -eq 0) {
  throw "No prompts provided. Pass -Prompt or -PromptFile."
}

Write-Host "Generation curl test started"
Write-Host "BaseUrl: $BaseUrl"
Write-Host "Model: $Model"
Write-Host "ProviderBaseUrl: $ProviderBaseUrl"
Write-Host "Prompt count: $($prompts.Count)"
Write-Host "Raw output log: $RawOutputFile"

try {
  $smokeAnswer = Invoke-SimpleLlmCheck -Question $SmokeQuestion
  Write-Host "Smoke test PASS: $smokeAnswer" -ForegroundColor Green
} catch {
  Write-GenerationFailure -Message $_.Exception.Message -PromptText $SmokeQuestion -Stage "smoke-test"
  exit 1
}

if ($SmokeTestOnly) {
  Write-Host "Smoke test only mode complete." -ForegroundColor Cyan
  exit 0
}

$successCount = 0
$failCount = 0

foreach ($promptText in $prompts) {
  Write-Host ""
  Write-Host "=== Prompt ===" -ForegroundColor Cyan
  Write-Host $promptText

  $outlineRaw = ""
  $contentRaw = ""
  $actionsRaw = ""

  try {
    $outlineBody = @{
      requirements = @{
        requirement = $promptText
        language = $Language
      }
      pdfText = $null
      pdfImages = @()
      imageMapping = @{}
      researchContext = ""
      agents = @()
    }
    $outlineRequestJson = ConvertTo-JsonCompat -InputObject $outlineBody -Depth 100

    $outlineRaw = Invoke-CurlJson -Url "$BaseUrl/api/generate/scene-outlines-stream" -Body $outlineBody -IsSse
    Write-RawTrace -Stage "scene-outlines-stream" -PromptText $promptText -Status "ok" -RequestJson $outlineRequestJson -RawOutput $outlineRaw
    $events = Parse-SseEvents -RawSse $outlineRaw

    $outlines = @()
    $streamError = $null
    $streamReason = $null
    $streamAttempts = $null
    foreach ($event in $events) {
      if ($event.type -eq "outline" -and $event.data) {
        $outlines += ,$event.data
      } elseif ($event.type -eq "done" -and $event.outlines) {
        $outlines = @($event.outlines)
      } elseif ($event.type -eq "error") {
        $streamError = [string]$event.error
        if ($event.PSObject.Properties.Name -contains "reason") {
          $streamReason = [string]$event.reason
        }
        if ($event.PSObject.Properties.Name -contains "attempts") {
          $streamAttempts = [string]$event.attempts
        }
      }
    }

    if ($streamError) {
      if ($streamReason) {
        $streamError = "$streamError [reason=$streamReason]"
      }
      if ($streamAttempts) {
        $streamError = "$streamError [attempts=$streamAttempts]"
      }
      Write-RawTrace -Stage "scene-outlines-stream" -PromptText $promptText -Status "error" -RequestJson $outlineRequestJson -RawOutput $outlineRaw
      Write-GenerationFailure -Message $streamError -PromptText $promptText -Stage "scene-outlines-stream" -RawOutput $outlineRaw
      $failCount++
      continue
    }

    if ($outlines.Count -eq 0) {
      Write-RawTrace -Stage "scene-outlines-stream" -PromptText $promptText -Status "error" -RequestJson $outlineRequestJson -RawOutput $outlineRaw
      Write-GenerationFailure -Message "LLM response could not be parsed" -PromptText $promptText -Stage "scene-outlines-stream" -RawOutput $outlineRaw
      $failCount++
      continue
    }

    $firstOutline = $outlines[0]
    $stageId = [Guid]::NewGuid().ToString("N").Substring(0, 10)
    $stageName = if ($promptText.Length -le 60) { $promptText } else { $promptText.Substring(0, 60) }

    $contentBody = @{
      outline = $firstOutline
      allOutlines = @($outlines)
      pdfImages = @()
      imageMapping = @{}
      stageInfo = @{
        name = $stageName
        description = ""
        language = $Language
        style = "professional"
      }
      stageId = $stageId
      agents = @()
    }
    $contentRequestJson = ConvertTo-JsonCompat -InputObject $contentBody -Depth 100

    $contentRaw = Invoke-CurlJson -Url "$BaseUrl/api/generate/scene-content" -Body $contentBody
    Write-RawTrace -Stage "scene-content" -PromptText $promptText -Status "ok" -RequestJson $contentRequestJson -RawOutput $contentRaw
    $contentJson = ConvertFrom-JsonCompat -InputText $contentRaw -Depth 100
    if (-not $contentJson.success -or -not $contentJson.content) {
      Write-RawTrace -Stage "scene-content" -PromptText $promptText -Status "error" -RequestJson $contentRequestJson -RawOutput $contentRaw
      $msg = if ($contentJson.error) { [string]$contentJson.error } else { "LLM response could not be parsed" }
      Write-GenerationFailure -Message $msg -PromptText $promptText -Stage "scene-content" -RawOutput $contentRaw
      $failCount++
      continue
    }

    $actionsBody = @{
      outline = $(if ($contentJson.effectiveOutline) { $contentJson.effectiveOutline } else { $firstOutline })
      allOutlines = @($outlines)
      content = $contentJson.content
      stageId = $stageId
      agents = @()
      previousSpeeches = @()
      userProfile = $null
    }
    $actionsRequestJson = ConvertTo-JsonCompat -InputObject $actionsBody -Depth 100

    $actionsRaw = Invoke-CurlJson -Url "$BaseUrl/api/generate/scene-actions" -Body $actionsBody
    Write-RawTrace -Stage "scene-actions" -PromptText $promptText -Status "ok" -RequestJson $actionsRequestJson -RawOutput $actionsRaw
    $actionsJson = ConvertFrom-JsonCompat -InputText $actionsRaw -Depth 100
    if (-not $actionsJson.success -or -not $actionsJson.scene) {
      Write-RawTrace -Stage "scene-actions" -PromptText $promptText -Status "error" -RequestJson $actionsRequestJson -RawOutput $actionsRaw
      $msg = if ($actionsJson.error) { [string]$actionsJson.error } else { "LLM response could not be parsed" }
      Write-GenerationFailure -Message $msg -PromptText $promptText -Stage "scene-actions" -RawOutput $actionsRaw
      $failCount++
      continue
    }

    Write-Host "PASS: outlines=$($outlines.Count), scene generated" -ForegroundColor Green
    $successCount++
  } catch {
    $fallbackRaw = if (-not [string]::IsNullOrWhiteSpace($actionsRaw)) {
      $actionsRaw
    } elseif (-not [string]::IsNullOrWhiteSpace($contentRaw)) {
      $contentRaw
    } else {
      $outlineRaw
    }
    Write-GenerationFailure -Message $_.Exception.Message -PromptText $promptText -Stage "runtime" -RawOutput $fallbackRaw
    $failCount++
  }
}

Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
Write-Host "Success: $successCount"
Write-Host "Failed:  $failCount"

if ($failCount -gt 0) {
  exit 1
}
