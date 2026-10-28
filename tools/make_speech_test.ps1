# Gera test\fala_pausas.mp4 (1080x1920): voz sintética do Windows com pausas de duração conhecida,
# para testar o AutoCut. Grava também test\fala_pausas_esperado.txt com início e fim de cada pausa.
# Uso: powershell -ExecutionPolicy Bypass -File tools\make_speech_test.ps1

Add-Type -AssemblyName System.Speech
$root = Join-Path $PSScriptRoot "..\test"
New-Item -ItemType Directory -Force $root | Out-Null
$wav = Join-Path $root "fala_pausas.wav"
$mp4 = Join-Path $root "fala_pausas.mp4"

$frases = @(
    "Esta é a primeira frase do teste de corte de silêncio.",
    "Depois de uma pausa longa, vem a segunda frase.",
    "Agora uma pausa curta.",
    "E esta é a última frase do teste."
)
$pausasMs = @(1500, 800, 300)   # a de 300 ms deve ficar (abaixo do mínimo padrão de 500 ms)

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(48000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$synth.SetOutputToWaveFile($wav, $fmt)
$pb = New-Object System.Speech.Synthesis.PromptBuilder
for ($i = 0; $i -lt $frases.Count; $i++) {
    $pb.AppendText($frases[$i])
    if ($i -lt $pausasMs.Count) { $pb.AppendBreak([TimeSpan]::FromMilliseconds($pausasMs[$i])) }
}
$synth.Speak($pb)
$synth.Dispose()

ffmpeg -y -loglevel error -f lavfi -i "color=c=0x334455:size=1080x1920:rate=30" -i $wav -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest $mp4
ffmpeg -hide_banner -i $wav -af "silencedetect=noise=-40dB:d=0.25" -f null - 2>&1 | Select-String "silence_" | Out-File (Join-Path $root "fala_pausas_esperado.txt")
Get-Content (Join-Path $root "fala_pausas_esperado.txt")
