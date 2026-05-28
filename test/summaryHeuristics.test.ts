import { describe, it, expect } from 'vitest';
import { generateFileSummary } from '../src/summaryHeuristics';

describe('summary heuristics', () => {
    describe('generateFileSummary', () => {
        it('produces class + function summary', () => {
            const summary = generateFileSummary('controller.ts', '', [
                { name: 'AuthController', type: 'class', line: 1 },
                { name: 'login', type: 'method', line: 5 },
                { name: 'logout', type: 'method', line: 15 },
            ], 30);
            expect(summary).toBe('controller.ts — defines AuthController with 2 function(s)');
        });

        it('produces class-only summary when no functions', () => {
            const summary = generateFileSummary('types.ts', '', [
                { name: 'Config', type: 'interface', line: 1 },
                { name: 'Status', type: 'enum', line: 10 },
            ], 20);
            expect(summary).toBe('types.ts — defines Config, Status');
        });

        it('produces function-only summary', () => {
            const summary = generateFileSummary('utils.ts', '', [
                { name: 'parseDate', type: 'function', line: 1 },
                { name: 'formatCurrency', type: 'function', line: 10 },
                { name: 'slugify', type: 'function', line: 20 },
            ], 50);
            expect(summary).toBe('utils.ts — 3 function(s) including parseDate, formatCurrency, slugify');
        });

        it('truncates long class lists with count', () => {
            const summary = generateFileSummary('models.ts', '', [
                { name: 'User', type: 'class', line: 1 },
                { name: 'Post', type: 'class', line: 20 },
                { name: 'Comment', type: 'class', line: 40 },
                { name: 'Tag', type: 'class', line: 60 },
                { name: 'Category', type: 'class', line: 80 },
                { name: 'save', type: 'method', line: 5 },
            ], 100);
            expect(summary).toBe('models.ts — defines User, Post, Comment and 2 more with 1 function(s)');
        });

        it('truncates long function lists with count', () => {
            const summary = generateFileSummary('math.ts', '', [
                { name: 'add', type: 'function', line: 1 },
                { name: 'subtract', type: 'function', line: 5 },
                { name: 'multiply', type: 'function', line: 10 },
                { name: 'divide', type: 'function', line: 15 },
                { name: 'power', type: 'function', line: 20 },
            ], 30);
            expect(summary).toBe('math.ts — 5 function(s) including add, subtract, multiply and 2 more');
        });

        it('falls back to line count when no symbols', () => {
            const summary = generateFileSummary('LibModbusCore.h', '', [], 27);
            expect(summary).toBe('LibModbusCore.h — 27 lines');
        });

        it('ignores file text entirely (no prose extraction)', () => {
            const licenseText = `/**
 * Copyright (c) 2024 ACME Corp. All rights reserved.
 * Manages OAuth token refresh logic.
 */
export function refresh() {}`;
            const summary = generateFileSummary('auth.ts', licenseText, [
                { name: 'refresh', type: 'function', line: 5 },
            ], 5);
            expect(summary).toBe('auth.ts — 1 function(s) including refresh');
        });

        it('never produces garbage from license headers', () => {
            const text = `/****************************************************************************
 * %TRULICENSE%
 * RESTRICTED PROPRIETARY SOFTWARE AND DATA
 * C 2015 TRU Simulation + Training Inc.
 ****************************************************************************/
#ifndef __LIB_H__
#define __LIB_H__
#include "other.h"
#endif`;
            const summary = generateFileSummary('TcpServerConnection.h', text, [
                { name: 'TcpServerConnection', type: 'class', line: 7 },
                { name: 'connect', type: 'method', line: 9 },
            ], 157);
            expect(summary).toBe('TcpServerConnection.h — defines TcpServerConnection with 1 function(s)');
        });

        it('handles constructors as functions', () => {
            const summary = generateFileSummary('widget.ts', '', [
                { name: 'Widget', type: 'class', line: 1 },
                { name: 'constructor', type: 'constructor', line: 3 },
                { name: 'render', type: 'method', line: 10 },
            ], 20);
            expect(summary).toBe('widget.ts — defines Widget with 2 function(s)');
        });
    });
});
