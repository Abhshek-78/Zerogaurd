/**
 * Signature Engine for ZeroGuard Gateway
 * Performs rapid heuristic regex inspection on headers, queries, and JSON body payloads.
 */

// Compiled High-Efficiency Regex Patterns
const SQLI_PATTERNS = [
  /(\%27)|(\')|(\-\-)|(\%23)|(#)/i,                            
  /((\%3D)|(=))[^\n]*((%27)|(\')|(\-\-)|(\%3B)|(;))/i,        
  /\w*((\%27)|(\'))(\s*)((\%6F)|o|(\%4F))((\%72)|r|(\%52))/i, 
  /(union|select|insert|update|delete|drop|alter|truncate)\s+[^\n]+/i, 
  /exec(\s|\+)+(s|x)p\w+/i                                   
];

const XSS_PATTERNS = [
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,     
  /javascript\s*:/gi,                                      
  /onerror\s*=/gi,                                           
  /onload\s*=/gi,
  /eval\((.*)\)/gi,                                         
  /<iframe/gi                                                
];

const PATH_TRAVERSAL_PATTERNS = [
  /\.\.\//g,                                                 
  /%2e%2e%2f/gi                                               
];

class SignatureEngine {
  constructor() {
    this.sqliRegexes = SQLI_PATTERNS;
    this.xssRegexes = XSS_PATTERNS;
    this.pathTraversalRegexes = PATH_TRAVERSAL_PATTERNS;
  }

  /**
   * Recursively flattens objects/arrays to inspect all values
   */
  _extractStrings(input, values = []) {
    if (typeof input === 'string') {
      values.push(input);
    } else if (typeof input === 'object' && input !== null) {
      for (const key of Object.keys(input)) {
        values.push(key); // Inspect keys too (e.g., JSON key injection)
        this._extractStrings(input[key], values);
      }
    }
    return values;
  }

  /**
   * Inspects a targets collection (query parameters, body fields, headers)
   * @returns {{ threatDetected: boolean, threatType: string|null, matchedPattern: string|null }}
   */
  inspect(payload) {
    const stringValues = this._extractStrings(payload);

    for (const value of stringValues) {
      // Decode URL encoding twice to defeat double-encoding evasions (e.g., %2527 -> %27 -> ')
      let decoded = value;
      try {
        decoded = decodeURIComponent(decodeURIComponent(value));
      } catch (e) {
        // Fall back to single decode or raw string if malformed
        try { decoded = decodeURIComponent(value); } catch (e2) {}
      }

      // Check SQL Injection
      for (const pattern of this.sqliRegexes) {
        pattern.lastIndex = 0;
        if (pattern.test(decoded)) {
          return { threatDetected: true, threatType: 'SQL_INJECTION', matchedValue: value };
        }
      }

      // Check Cross-Site Scripting (XSS)
      for (const pattern of this.xssRegexes) {
        pattern.lastIndex = 0;
        if (pattern.test(decoded)) {
          return { threatDetected: true, threatType: 'XSS_ATTACK', matchedValue: value };
        }
      }

      // Check Path Traversal
      for (const pattern of this.pathTraversalRegexes) {
        pattern.lastIndex = 0;
        if (pattern.test(decoded)) {
          return { threatDetected: true, threatType: 'PATH_TRAVERSAL', matchedValue: value };
        }
      }
    }

    return { threatDetected: false, threatType: null, matchedValue: null };
  }
}

module.exports = SignatureEngine;