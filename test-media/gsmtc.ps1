try {
  [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
  [WindowsRuntimeSystemExtensions, System.Runtime.WindowsRuntime, ContentType = WindowsRuntime] | Out-Null
  $op = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
  $task = [System.WindowsRuntimeSystemExtensions]::AsTask($op)
  $task.Wait()
  $mgr = $task.Result
  $sessions = $mgr.GetSessions()
  $n = 0
  foreach ($s in $sessions) {
    $n++
    $pOp = $s.GetGlobalPropertiesAsync()
    $pT = [System.WindowsRuntimeSystemExtensions]::AsTask($pOp)
    $pT.Wait()
    $props = $pT.Result
    $line = "GSMTC-SESSION#{0}: AUMID={1} | Title={2} | Artist={3} | Album={4}" -f $n, $s.SourceAppUserModelId, $props.Title, $props.Artist, $props.AlbumTitle
    Write-Output $line
  }
  if ($n -eq 0) { Write-Output "GSMTC: no active media sessions" }
} catch {
  Write-Output ("GSMTC-ERROR: " + $_.Exception.Message)
}
