// 根清单签名的固定测试向量，生成后私钥即丢弃。发版脚本与前端单测核对同一份数据：正例必须验过，
// rejects 依次是篡改 payload、篡改签名与 DER 格式签名，必须验不过。

export const SIGNATURE_VECTORS = {
  keyId: 'test-vector',
  spki: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEM26feRq4Ya4RljDrs5jqVtad3DLDX0RCTy2KoR5tYrv59rx/oKhPTDvZWBo6Ul3XkLMjOB+tE/L4adc8XfDRwQ==',
  payload:
    '{"format":1,"serial":7,"minUpdater":1,"channels":{"stable":[{"version":"0.2.0","upgradeFrom":">=0.1.0","requires":{"foo_ui_webview2":">=2.0.0"},"requiresLoader":1,"release":"https://cnb.cool/foo-ui-webview2/default-theme/-/releases/download/v0.2.0/release.json","releaseSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]},"revoked":[],"keys":[],"revokedKeys":[],"note":"测试向量：签名对象是 UTF-8 字节"}',
  signature:
    'HZFXBJjZKpdIIn5IkotUlfgW50AfjGLVZQ9j0lps2jwCec66Rde5jXXOk7grnoe8xtS7nfAhKFmNr8Fz56a/XQ==',
  rejects: [
    {
      payload:
        '{"format":1,"serial":8,"minUpdater":1,"channels":{"stable":[{"version":"0.2.0","upgradeFrom":">=0.1.0","requires":{"foo_ui_webview2":">=2.0.0"},"requiresLoader":1,"release":"https://cnb.cool/foo-ui-webview2/default-theme/-/releases/download/v0.2.0/release.json","releaseSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]},"revoked":[],"keys":[],"revokedKeys":[],"note":"测试向量：签名对象是 UTF-8 字节"}',
      signature:
        'HZFXBJjZKpdIIn5IkotUlfgW50AfjGLVZQ9j0lps2jwCec66Rde5jXXOk7grnoe8xtS7nfAhKFmNr8Fz56a/XQ==',
    },
    {
      payload:
        '{"format":1,"serial":7,"minUpdater":1,"channels":{"stable":[{"version":"0.2.0","upgradeFrom":">=0.1.0","requires":{"foo_ui_webview2":">=2.0.0"},"requiresLoader":1,"release":"https://cnb.cool/foo-ui-webview2/default-theme/-/releases/download/v0.2.0/release.json","releaseSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]},"revoked":[],"keys":[],"revokedKeys":[],"note":"测试向量：签名对象是 UTF-8 字节"}',
      signature:
        'HZFXBJjZKpdIIn9IkotUlfgW50AfjGLVZQ9j0lps2jwCec66Rde5jXXOk7grnoe8xtS7nfAhKFmNr8Fz56a/XQ==',
    },
    {
      payload:
        '{"format":1,"serial":7,"minUpdater":1,"channels":{"stable":[{"version":"0.2.0","upgradeFrom":">=0.1.0","requires":{"foo_ui_webview2":">=2.0.0"},"requiresLoader":1,"release":"https://cnb.cool/foo-ui-webview2/default-theme/-/releases/download/v0.2.0/release.json","releaseSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]},"revoked":[],"keys":[],"revokedKeys":[],"note":"测试向量：签名对象是 UTF-8 字节"}',
      signature:
        'MEQCIEteIq1Vlo/p+QsAy6qjZqrpvHN26b8XTwmreKd3W4txAiB2HXokBs84x9/3z6eA2+r1aV8f0FGC0L9GigB9tZfrAw==',
    },
  ],
};
