import type { AppConfig, Config, OAuthConfig } from '../config/index.js';
import type { AppReport, OAuthReport, Report, ScanResult, Severity } from '../types.js';
import { evaluateApp } from './app.js';
import { evaluateOAuth } from './oauth.js';
export { findingId, VERSION } from './shared.js';
export function evaluate(scan: ScanResult, config: OAuthConfig): OAuthReport;
export function evaluate(scan: ScanResult, config: AppConfig): AppReport;
export function evaluate(scan: ScanResult, config: Config): Report;
export function evaluate(scan: ScanResult, config: Config): Report {
 if (scan.operations.some(op => op.provider !== config.provider)) throw new Error('Scan provider does not match the configured permission model.');
 return config.provider === 'github-app' ? evaluateApp(scan, config) : evaluateOAuth(scan, config);
}
export function shouldFail(report: Report, threshold: Severity): boolean {
 const order: Severity[] = ['info', 'low', 'medium', 'high'];
 return report.findings.some(f => f.category === 'insufficient' && f.confidence !== 'low' && order.indexOf(f.severity) >= order.indexOf(threshold));
}
