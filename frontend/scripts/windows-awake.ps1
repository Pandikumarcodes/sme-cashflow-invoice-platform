Add-Type -ErrorAction Stop -TypeDefinition @'
using System.Runtime.InteropServices;
public static class SmeTestExecutionState {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint SetThreadExecutionState(uint flags);
}
'@

# ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED.
# This is a thread request, not a persistent power-plan change.
if ([SmeTestExecutionState]::SetThreadExecutionState([uint32]2147483651) -eq 0) {
    throw 'Windows refused the temporary test awake request.'
}
try {
    [Console]::WriteLine('TEST_HOST_AWAKE')
    # The owner keeps stdin open only while its bounded verification batch runs.
    # EOF also releases the request if that owner exits unexpectedly.
    [Console]::ReadLine() | Out-Null
} finally {
    [SmeTestExecutionState]::SetThreadExecutionState([uint32]2147483648) | Out-Null
}
