/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import { identifierName, ngModuleJitUrl, sharedStylesheetJitUrl, templateJitUrl, templateSourceUrl } from '../compile_metadata';
import { ConstantPool } from '../constant_pool';
import * as ir from '../output/output_ast';
import { interpretStatements } from '../output/output_interpreter';
import { jitStatements } from '../output/output_jit';
import { SyncAsync, stringify } from '../util';
/**
 * An internal module of the Angular compiler that begins with component types,
 * extracts templates, and eventually produces a compiled version of the component
 * ready for linking into an application.
 *
 * @security  When compiling templates at runtime, you must ensure that the entire template comes
 * from a trusted source. Attacker-controlled data introduced by a template could expose your
 * application to XSS risks.  For more detail, see the [Security Guide](http://g.co/ng/security).
 */
var JitCompiler = /** @class */ (function () {
    function JitCompiler(_metadataResolver, _templateParser, _styleCompiler, _viewCompiler, _ngModuleCompiler, _summaryResolver, _reflector, _compilerConfig, _console, getExtraNgModuleProviders) {
        this._metadataResolver = _metadataResolver;
        this._templateParser = _templateParser;
        this._styleCompiler = _styleCompiler;
        this._viewCompiler = _viewCompiler;
        this._ngModuleCompiler = _ngModuleCompiler;
        this._summaryResolver = _summaryResolver;
        this._reflector = _reflector;
        this._compilerConfig = _compilerConfig;
        this._console = _console;
        this.getExtraNgModuleProviders = getExtraNgModuleProviders;
        this._compiledTemplateCache = new Map();
        this._compiledHostTemplateCache = new Map();
        this._compiledDirectiveWrapperCache = new Map();
        this._compiledNgModuleCache = new Map();
        this._sharedStylesheetCount = 0;
        this._addedAotSummaries = new Set();
    }
    JitCompiler.prototype.compileModuleSync = function (moduleType) {
        return SyncAsync.assertSync(this._compileModuleAndComponents(moduleType, true));
    };
    JitCompiler.prototype.compileModuleAsync = function (moduleType) {
        return Promise.resolve(this._compileModuleAndComponents(moduleType, false));
    };
    JitCompiler.prototype.compileModuleAndAllComponentsSync = function (moduleType) {
        return SyncAsync.assertSync(this._compileModuleAndAllComponents(moduleType, true));
    };
    JitCompiler.prototype.compileModuleAndAllComponentsAsync = function (moduleType) {
        return Promise.resolve(this._compileModuleAndAllComponents(moduleType, false));
    };
    JitCompiler.prototype.getComponentFactory = function (component) {
        var summary = this._metadataResolver.getDirectiveSummary(component);
        return summary.componentFactory;
    };
    JitCompiler.prototype.loadAotSummaries = function (summaries) {
        this.clearCache();
        this._addAotSummaries(summaries);
    };
    JitCompiler.prototype._addAotSummaries = function (fn) {
        if (this._addedAotSummaries.has(fn)) {
            return;
        }
        this._addedAotSummaries.add(fn);
        var summaries = fn();
        for (var i = 0; i < summaries.length; i++) {
            var entry = summaries[i];
            if (typeof entry === 'function') {
                this._addAotSummaries(entry);
            }
            else {
                var summary = entry;
                this._summaryResolver.addSummary({ symbol: summary.type.reference, metadata: null, type: summary });
            }
        }
    };
    JitCompiler.prototype.hasAotSummary = function (ref) { return !!this._summaryResolver.resolveSummary(ref); };
    JitCompiler.prototype._filterJitIdentifiers = function (ids) {
        var _this = this;
        return ids.map(function (mod) { return mod.reference; }).filter(function (ref) { return !_this.hasAotSummary(ref); });
    };
    JitCompiler.prototype._compileModuleAndComponents = function (moduleType, isSync) {
        var _this = this;
        return SyncAsync.then(this._loadModules(moduleType, isSync), function () {
            _this._compileComponents(moduleType, null);
            return _this._compileModule(moduleType);
        });
    };
    JitCompiler.prototype._compileModuleAndAllComponents = function (moduleType, isSync) {
        var _this = this;
        return SyncAsync.then(this._loadModules(moduleType, isSync), function () {
            var componentFactories = [];
            _this._compileComponents(moduleType, componentFactories);
            return {
                ngModuleFactory: _this._compileModule(moduleType),
                componentFactories: componentFactories
            };
        });
    };
    JitCompiler.prototype._loadModules = function (mainModule, isSync) {
        var _this = this;
        var loading = [];
        var mainNgModule = this._metadataResolver.getNgModuleMetadata(mainModule);
        // Note: for runtime compilation, we want to transitively compile all modules,
        // so we also need to load the declared directives / pipes for all nested modules.
        this._filterJitIdentifiers(mainNgModule.transitiveModule.modules).forEach(function (nestedNgModule) {
            // getNgModuleMetadata only returns null if the value passed in is not an NgModule
            var moduleMeta = _this._metadataResolver.getNgModuleMetadata(nestedNgModule);
            _this._filterJitIdentifiers(moduleMeta.declaredDirectives).forEach(function (ref) {
                var promise = _this._metadataResolver.loadDirectiveMetadata(moduleMeta.type.reference, ref, isSync);
                if (promise) {
                    loading.push(promise);
                }
            });
            _this._filterJitIdentifiers(moduleMeta.declaredPipes)
                .forEach(function (ref) { return _this._metadataResolver.getOrLoadPipeMetadata(ref); });
        });
        return SyncAsync.all(loading);
    };
    JitCompiler.prototype._compileModule = function (moduleType) {
        var ngModuleFactory = this._compiledNgModuleCache.get(moduleType);
        if (!ngModuleFactory) {
            var moduleMeta = this._metadataResolver.getNgModuleMetadata(moduleType);
            // Always provide a bound Compiler
            var extraProviders = this.getExtraNgModuleProviders(moduleMeta.type.reference);
            var outputCtx = createOutputContext();
            var compileResult = this._ngModuleCompiler.compile(outputCtx, moduleMeta, extraProviders);
            ngModuleFactory = this._interpretOrJit(ngModuleJitUrl(moduleMeta), outputCtx.statements)[compileResult.ngModuleFactoryVar];
            this._compiledNgModuleCache.set(moduleMeta.type.reference, ngModuleFactory);
        }
        return ngModuleFactory;
    };
    /**
     * @internal
     */
    JitCompiler.prototype._compileComponents = function (mainModule, allComponentFactories) {
        var _this = this;
        var ngModule = this._metadataResolver.getNgModuleMetadata(mainModule);
        var moduleByJitDirective = new Map();
        var templates = new Set();
        var transJitModules = this._filterJitIdentifiers(ngModule.transitiveModule.modules);
        transJitModules.forEach(function (localMod) {
            var localModuleMeta = _this._metadataResolver.getNgModuleMetadata(localMod);
            _this._filterJitIdentifiers(localModuleMeta.declaredDirectives).forEach(function (dirRef) {
                moduleByJitDirective.set(dirRef, localModuleMeta);
                var dirMeta = _this._metadataResolver.getDirectiveMetadata(dirRef);
                if (dirMeta.isComponent) {
                    templates.add(_this._createCompiledTemplate(dirMeta, localModuleMeta));
                    if (allComponentFactories) {
                        var template = _this._createCompiledHostTemplate(dirMeta.type.reference, localModuleMeta);
                        templates.add(template);
                        allComponentFactories.push(dirMeta.componentFactory);
                    }
                }
            });
        });
        transJitModules.forEach(function (localMod) {
            var localModuleMeta = _this._metadataResolver.getNgModuleMetadata(localMod);
            _this._filterJitIdentifiers(localModuleMeta.declaredDirectives).forEach(function (dirRef) {
                var dirMeta = _this._metadataResolver.getDirectiveMetadata(dirRef);
                if (dirMeta.isComponent) {
                    dirMeta.entryComponents.forEach(function (entryComponentType) {
                        var moduleMeta = moduleByJitDirective.get(entryComponentType.componentType);
                        templates.add(_this._createCompiledHostTemplate(entryComponentType.componentType, moduleMeta));
                    });
                }
            });
            localModuleMeta.entryComponents.forEach(function (entryComponentType) {
                if (!_this.hasAotSummary(entryComponentType.componentType)) {
                    var moduleMeta = moduleByJitDirective.get(entryComponentType.componentType);
                    templates.add(_this._createCompiledHostTemplate(entryComponentType.componentType, moduleMeta));
                }
            });
        });
        templates.forEach(function (template) { return _this._compileTemplate(template); });
    };
    JitCompiler.prototype.clearCacheFor = function (type) {
        this._compiledNgModuleCache.delete(type);
        this._metadataResolver.clearCacheFor(type);
        this._compiledHostTemplateCache.delete(type);
        var compiledTemplate = this._compiledTemplateCache.get(type);
        if (compiledTemplate) {
            this._compiledTemplateCache.delete(type);
        }
    };
    JitCompiler.prototype.clearCache = function () {
        // Note: don't clear the _addedAotSummaries, as they don't change!
        this._metadataResolver.clearCache();
        this._compiledTemplateCache.clear();
        this._compiledHostTemplateCache.clear();
        this._compiledNgModuleCache.clear();
    };
    JitCompiler.prototype._createCompiledHostTemplate = function (compType, ngModule) {
        if (!ngModule) {
            throw new Error("Component " + stringify(compType) + " is not part of any NgModule or the module has not been imported into your module.");
        }
        var compiledTemplate = this._compiledHostTemplateCache.get(compType);
        if (!compiledTemplate) {
            var compMeta = this._metadataResolver.getDirectiveMetadata(compType);
            assertComponent(compMeta);
            var hostMeta = this._metadataResolver.getHostComponentMetadata(compMeta, compMeta.componentFactory.viewDefFactory);
            compiledTemplate =
                new CompiledTemplate(true, compMeta.type, hostMeta, ngModule, [compMeta.type]);
            this._compiledHostTemplateCache.set(compType, compiledTemplate);
        }
        return compiledTemplate;
    };
    JitCompiler.prototype._createCompiledTemplate = function (compMeta, ngModule) {
        var compiledTemplate = this._compiledTemplateCache.get(compMeta.type.reference);
        if (!compiledTemplate) {
            assertComponent(compMeta);
            compiledTemplate = new CompiledTemplate(false, compMeta.type, compMeta, ngModule, ngModule.transitiveModule.directives);
            this._compiledTemplateCache.set(compMeta.type.reference, compiledTemplate);
        }
        return compiledTemplate;
    };
    JitCompiler.prototype._compileTemplate = function (template) {
        var _this = this;
        if (template.isCompiled) {
            return;
        }
        var compMeta = template.compMeta;
        var externalStylesheetsByModuleUrl = new Map();
        var outputContext = createOutputContext();
        var componentStylesheet = this._styleCompiler.compileComponent(outputContext, compMeta);
        compMeta.template.externalStylesheets.forEach(function (stylesheetMeta) {
            var compiledStylesheet = _this._styleCompiler.compileStyles(createOutputContext(), compMeta, stylesheetMeta);
            externalStylesheetsByModuleUrl.set(stylesheetMeta.moduleUrl, compiledStylesheet);
        });
        this._resolveStylesCompileResult(componentStylesheet, externalStylesheetsByModuleUrl);
        var pipes = template.ngModule.transitiveModule.pipes.map(function (pipe) { return _this._metadataResolver.getPipeSummary(pipe.reference); });
        var _a = this._parseTemplate(compMeta, template.ngModule, template.directives), parsedTemplate = _a.template, usedPipes = _a.pipes;
        var compileResult = this._viewCompiler.compileComponent(outputContext, compMeta, parsedTemplate, ir.variable(componentStylesheet.stylesVar), usedPipes);
        var evalResult = this._interpretOrJit(templateJitUrl(template.ngModule.type, template.compMeta), outputContext.statements);
        var viewClass = evalResult[compileResult.viewClassVar];
        var rendererType = evalResult[compileResult.rendererTypeVar];
        template.compiled(viewClass, rendererType);
    };
    JitCompiler.prototype._parseTemplate = function (compMeta, ngModule, directiveIdentifiers) {
        var _this = this;
        // Note: ! is ok here as components always have a template.
        var preserveWhitespaces = compMeta.template.preserveWhitespaces;
        var directives = directiveIdentifiers.map(function (dir) { return _this._metadataResolver.getDirectiveSummary(dir.reference); });
        var pipes = ngModule.transitiveModule.pipes.map(function (pipe) { return _this._metadataResolver.getPipeSummary(pipe.reference); });
        return this._templateParser.parse(compMeta, compMeta.template.htmlAst, directives, pipes, ngModule.schemas, templateSourceUrl(ngModule.type, compMeta, compMeta.template), preserveWhitespaces);
    };
    JitCompiler.prototype._resolveStylesCompileResult = function (result, externalStylesheetsByModuleUrl) {
        var _this = this;
        result.dependencies.forEach(function (dep, i) {
            var nestedCompileResult = externalStylesheetsByModuleUrl.get(dep.moduleUrl);
            var nestedStylesArr = _this._resolveAndEvalStylesCompileResult(nestedCompileResult, externalStylesheetsByModuleUrl);
            dep.setValue(nestedStylesArr);
        });
    };
    JitCompiler.prototype._resolveAndEvalStylesCompileResult = function (result, externalStylesheetsByModuleUrl) {
        this._resolveStylesCompileResult(result, externalStylesheetsByModuleUrl);
        return this._interpretOrJit(sharedStylesheetJitUrl(result.meta, this._sharedStylesheetCount++), result.outputCtx.statements)[result.stylesVar];
    };
    JitCompiler.prototype._interpretOrJit = function (sourceUrl, statements) {
        if (!this._compilerConfig.useJit) {
            return interpretStatements(statements, this._reflector);
        }
        else {
            return jitStatements(sourceUrl, statements, this._reflector, this._compilerConfig.jitDevMode);
        }
    };
    return JitCompiler;
}());
export { JitCompiler };
var CompiledTemplate = /** @class */ (function () {
    function CompiledTemplate(isHost, compType, compMeta, ngModule, directives) {
        this.isHost = isHost;
        this.compType = compType;
        this.compMeta = compMeta;
        this.ngModule = ngModule;
        this.directives = directives;
        this._viewClass = null;
        this.isCompiled = false;
    }
    CompiledTemplate.prototype.compiled = function (viewClass, rendererType) {
        this._viewClass = viewClass;
        this.compMeta.componentViewType.setDelegate(viewClass);
        for (var prop in rendererType) {
            this.compMeta.rendererType[prop] = rendererType[prop];
        }
        this.isCompiled = true;
    };
    return CompiledTemplate;
}());
function assertComponent(meta) {
    if (!meta.isComponent) {
        throw new Error("Could not compile '" + identifierName(meta.type) + "' because it is not a component.");
    }
}
function createOutputContext() {
    var importExpr = function (symbol) {
        return ir.importExpr({ name: identifierName(symbol), moduleName: null, runtime: symbol });
    };
    return { statements: [], genFilePath: '', importExpr: importExpr, constantPool: new ConstantPool() };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29tcGlsZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi8uLi8uLi8uLi8uLi8uLi9wYWNrYWdlcy9jb21waWxlci9zcmMvaml0L2NvbXBpbGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBOzs7Ozs7R0FNRztBQUVILE9BQU8sRUFBcU0sY0FBYyxFQUFFLGNBQWMsRUFBRSxzQkFBc0IsRUFBRSxjQUFjLEVBQUUsaUJBQWlCLEVBQUMsTUFBTSxxQkFBcUIsQ0FBQztBQUdsVSxPQUFPLEVBQUMsWUFBWSxFQUFDLE1BQU0sa0JBQWtCLENBQUM7QUFJOUMsT0FBTyxLQUFLLEVBQUUsTUFBTSxzQkFBc0IsQ0FBQztBQUMzQyxPQUFPLEVBQUMsbUJBQW1CLEVBQUMsTUFBTSw4QkFBOEIsQ0FBQztBQUNqRSxPQUFPLEVBQUMsYUFBYSxFQUFDLE1BQU0sc0JBQXNCLENBQUM7QUFLbkQsT0FBTyxFQUF5QixTQUFTLEVBQUUsU0FBUyxFQUFDLE1BQU0sU0FBUyxDQUFDO0FBUXJFOzs7Ozs7OztHQVFHO0FBQ0g7SUFRRSxxQkFDWSxpQkFBMEMsRUFBVSxlQUErQixFQUNuRixjQUE2QixFQUFVLGFBQTJCLEVBQ2xFLGlCQUFtQyxFQUFVLGdCQUF1QyxFQUNwRixVQUE0QixFQUFVLGVBQStCLEVBQ3JFLFFBQWlCLEVBQ2pCLHlCQUF1RTtRQUx2RSxzQkFBaUIsR0FBakIsaUJBQWlCLENBQXlCO1FBQVUsb0JBQWUsR0FBZixlQUFlLENBQWdCO1FBQ25GLG1CQUFjLEdBQWQsY0FBYyxDQUFlO1FBQVUsa0JBQWEsR0FBYixhQUFhLENBQWM7UUFDbEUsc0JBQWlCLEdBQWpCLGlCQUFpQixDQUFrQjtRQUFVLHFCQUFnQixHQUFoQixnQkFBZ0IsQ0FBdUI7UUFDcEYsZUFBVSxHQUFWLFVBQVUsQ0FBa0I7UUFBVSxvQkFBZSxHQUFmLGVBQWUsQ0FBZ0I7UUFDckUsYUFBUSxHQUFSLFFBQVEsQ0FBUztRQUNqQiw4QkFBeUIsR0FBekIs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LENBQUMsU0FBUyxDQUFDLENBQUM7UUFDckUsS0FBSyxJQUFJLElBQUksSUFBSSxZQUFZLEVBQUU7WUFDdkIsSUFBSSxDQUFDLFFBQVEsQ0FBQyxZQUFhLENBQUMsSUFBSSxDQUFDLEdBQUcsWUFBWSxDQUFDLElBQUksQ0FBQyxDQUFDO1NBQzlEO1FBQ0QsSUFBSSxDQUFDLFVBQVUsR0FBRyxJQUFJLENBQUM7SUFDekIsQ0FBQztJQUNILHVCQUFDO0FBQUQsQ0FBQyxBQWpCRCxJQWlCQztBQUVELHlCQUF5QixJQUE4QjtJQUNyRCxJQUFJLENBQUMsSUFBSSxDQUFDLFdBQVcsRUFBRTtRQUNyQixNQUFNLElBQUksS0FBSyxDQUNYLHdCQUFzQixjQUFjLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxxQ0FBa0MsQ0FBQyxDQUFDO0tBQ3hGO0FBQ0gsQ0FBQztBQUVEO0lBQ0UsSUFBTSxVQUFVLEdBQUcsVUFBQyxNQUFXO1FBQzNCLE9BQUEsRUFBRSxDQUFDLFVBQVUsQ0FBQyxFQUFDLElBQUksRUFBRSxjQUFjLENBQUMsTUFBTSxDQUFDLEVBQUUsVUFBVSxFQUFFLElBQUksRUFBRSxPQUFPLEVBQUUsTUFBTSxFQUFDLENBQUM7SUFBaEYsQ0FBZ0YsQ0FBQztJQUNyRixPQUFPLEVBQUMsVUFBVSxFQUFFLEVBQUUsRUFBRSxXQUFXLEVBQUUsRUFBRSxFQUFFLFVBQVUsWUFBQSxFQUFFLFlBQVksRUFBRSxJQUFJLFlBQVksRUFBRSxFQUFDLENBQUM7QUFDekYsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQGxpY2Vuc2VcbiAqIENvcHlyaWdodCBHb29nbGUgSW5jLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGFuIE1JVC1zdHlsZSBsaWNlbnNlIHRoYXQgY2FuIGJlXG4gKiBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGF0IGh0dHBzOi8vYW5ndWxhci5pby9saWNlbnNlXG4gKi9cblxuaW1wb3J0IHtDb21waWxlRGlyZWN0aXZlTWV0YWRhdGEsIENvbXBpbGVJZGVudGlmaWVyTWV0YWRhdGEsIENvbXBpbGVOZ01vZHVsZU1ldGFkYXRhLCBDb21waWxlUGlwZVN1bW1hcnksIENvbXBpbGVQcm92aWRlck1ldGFkYXRhLCBDb21waWxlU3R5bGVzaGVldE1ldGFkYXRhLCBDb21waWxlVHlwZVN1bW1hcnksIFByb3ZpZGVyTWV0YSwgUHJveHlDbGFzcywgaWRlbnRpZmllck5hbWUsIG5nTW9kdWxlSml0VXJsLCBzaGFyZWRTdHlsZXNoZWV0Sml0VXJsLCB0ZW1wbGF0ZUppdFVybCwgdGVtcGxhdGVTb3VyY2VVcmx9IGZyb20gJy4uL2NvbXBpbGVfbWV0YWRhdGEnO1xuaW1wb3J0IHtDb21waWxlUmVmbGVjdG9yfSBmcm9tICcuLi9jb21waWxlX3JlZmxlY3Rvcic7XG5pbXBvcnQge0NvbXBpbGVyQ29uZmlnfSBmcm9tICcuLi9jb25maWcnO1xuaW1wb3J0IHtDb25zdGFudFBvb2x9IGZyb20gJy4uL2NvbnN0YW50X3Bvb2wnO1xuaW1wb3J0IHtUeXBlfSBmcm9tICcuLi9jb3JlJztcbmltcG9ydCB7Q29tcGlsZU1ldGFkYXRhUmVzb2x2ZXJ9IGZyb20gJy4uL21ldGFkYXRhX3Jlc29sdmVyJztcbmltcG9ydCB7TmdNb2R1bGVDb21waWxlcn0gZnJvbSAnLi4vbmdfbW9kdWxlX2NvbXBpbGVyJztcbmltcG9ydCAqIGFzIGlyIGZyb20gJy4uL291dHB1dC9vdXRwdXRfYXN0JztcbmltcG9ydCB7aW50ZXJwcmV0U3RhdGVtZW50c30gZnJvbSAnLi4vb3V0cHV0L291dHB1dF9pbnRlcnByZXRlcic7XG5pbXBvcnQge2ppdFN0YXRlbWVudHN9IGZyb20gJy4uL291dHB1dC9vdXRwdXRfaml0JztcbmltcG9ydCB7Q29tcGlsZWRTdHlsZXNoZWV0LCBTdHlsZUNvbXBpbGVyfSBmcm9tICcuLi9zdHlsZV9jb21waWxlcic7XG5pbXBvcnQge1N1bW1hcnlSZXNvbHZlcn0gZnJvbSAnLi4vc3VtbWFyeV9yZXNvbHZlcic7XG5pbXBvcnQge1RlbXBsYXRlQXN0fSBmcm9tICcuLi90ZW1wbGF0ZV9wYXJzZXIvdGVtcGxhdGVfYXN0JztcbmltcG9ydCB7VGVtcGxhdGVQYXJzZXJ9IGZyb20gJy4uL3RlbXBsYXRlX3BhcnNlci90ZW1wbGF0ZV9wYXJzZXInO1xuaW1wb3J0IHtDb25zb2xlLCBPdXRwdXRDb250ZXh0LCBTeW5jQXN5bmMsIHN0cmluZ2lmeX0gZnJvbSAnLi4vdXRpbCc7XG5pbXBvcnQge1ZpZXdDb21waWxlcn0gZnJvbSAnLi4vdmlld19jb21waWxlci92aWV3X2NvbXBpbGVyJztcblxuZXhwb3J0IGludGVyZmFjZSBNb2R1bGVXaXRoQ29tcG9uZW50RmFjdG9yaWVzIHtcbiAgbmdNb2R1bGVGYWN0b3J5OiBvYmplY3Q7XG4gIGNvbXBvbmVudEZhY3Rvcmllczogb2JqZWN0W107XG59XG5cbi8qKlxuICogQW4gaW50ZXJuYWwgbW9kdWxlIG9mIHRoZSBBbmd1bGFyIGNvbXBpbGVyIHRoYXQgYmVnaW5zIHdpdGggY29tcG9uZW50IHR5cGVzLFxuICogZXh0cmFjdHMgdGVtcGxhdGVzLCBhbmQgZXZlbnR1YWxseSBwcm9kdWNlcyBhIGNvbXBpbGVkIHZlcnNpb24gb2YgdGhlIGNvbXBvbmVudFxuICogcmVhZHkgZm9yIGxpbmtpbmcgaW50byBhbiBhcHBsaWNhdGlvbi5cbiAqXG4gKiBAc2VjdXJpdHkgIFdoZW4gY29tcGlsaW5nIHRlbXBsYXRlcyBhdCBydW50aW1lLCB5b3UgbXVzdCBlbnN1cmUgdGhhdCB0aGUgZW50aXJlIHRlbXBsYXRlIGNvbWVzXG4gKiBmcm9tIGEgdHJ1c3RlZCBzb3VyY2UuIEF0dGFja2VyLWNvbnRyb2xsZWQgZGF0YSBpbnRyb2R1Y2VkIGJ5IGEgdGVtcGxhdGUgY291bGQgZXhwb3NlIHlvdXJcbiAqIGFwcGxpY2F0aW9uIHRvIFhTUyByaXNrcy4gIEZvciBtb3JlIGRldGFpbCwgc2VlIHRoZSBbU2VjdXJpdHkgR3VpZGVdKGh0dHA6Ly9nLmNvL25nL3NlY3VyaXR5KS5cbiAqL1xuZXhwb3J0IGNsYXNzIEppdENvbXBpbGVyIHtcbiAgcHJpdmF0ZSBfY29tcGlsZWRUZW1wbGF0ZUNhY2hlID0gbmV3IE1hcDxUeXBlLCBDb21waWxlZFRlbXBsYXRlPigpO1xuICBwcml2YXRlIF9jb21waWxlZEhvc3RUZW1wbGF0ZUNhY2hlID0gbmV3IE1hcDxUeXBlLCBDb21waWxlZFRlbXBsYXRlPigpO1xuICBwcml2YXRlIF9jb21waWxlZERpcmVjdGl2ZVdyYXBwZXJDYWNoZSA9IG5ldyBNYXA8VHlwZSwgVHlwZT4oKTtcbiAgcHJpdmF0ZSBfY29tcGlsZWROZ01vZHVsZUNhY2hlID0gbmV3IE1hcDxUeXBlLCBvYmplY3Q+KCk7XG4gIHByaXZhdGUgX3NoYXJlZFN0eWxlc2hlZXRDb3VudCA9IDA7XG4gIHByaXZhdGUgX2FkZGVkQW90U3VtbWFyaWVzID0gbmV3IFNldDwoKSA9PiBhbnlbXT4oKTtcblxuICBjb25zdHJ1Y3RvcihcbiAgICAgIHByaXZhdGUgX21ldGFkYXRhUmVzb2x2ZXI6IENvbXBpbGVNZXRhZGF0YVJlc29sdmVyLCBwcml2YXRlIF90ZW1wbGF0ZVBhcnNlcjogVGVtcGxhdGVQYXJzZXIsXG4gICAgICBwcml2YXRlIF9zdHlsZUNvbXBpbGVyOiBTdHlsZUNvbXBpbGVyLCBwcml2YXRlIF92aWV3Q29tcGlsZXI6IFZpZXdDb21waWxlcixcbiAgICAgIHByaXZhdGUgX25nTW9kdWxlQ29tcGlsZXI6IE5nTW9kdWxlQ29tcGlsZXIsIHByaXZhdGUgX3N1bW1hcnlSZXNvbHZlcjogU3VtbWFyeVJlc29sdmVyPFR5cGU+LFxuICAgICAgcHJpdmF0ZSBfcmVmbGVjdG9yOiBDb21waWxlUmVmbGVjdG9yLCBwcml2YXRlIF9jb21waWxlckNvbmZpZzogQ29tcGlsZXJDb25maWcsXG4gICAgICBwcml2YXRlIF9jb25zb2xlOiBDb25zb2xlLFxuICAgICAgcHJpdmF0ZSBnZXRFeHRyYU5nTW9kdWxlUHJvdmlkZXJzOiAobmdNb2R1bGU6IGFueSkgPT4gQ29tcGlsZVByb3ZpZGVyTWV0YWRhdGFbXSkge31cblxuICBjb21waWxlTW9kdWxlU3luYyhtb2R1bGVUeXBlOiBUeXBlKTogb2JqZWN0IHtcbiAgICByZXR1cm4gU3luY0FzeW5jLmFzc2VydFN5bmModGhpcy5fY29tcGlsZU1vZHVsZUFuZENvbXBvbmVudHMobW9kdWxlVHlwZSwgdHJ1ZSkpO1xuICB9XG5cbiAgY29tcGlsZU1vZHVsZUFzeW5jKG1vZHVsZVR5cGU6IFR5cGUpOiBQcm9taXNlPG9iamVjdD4ge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUodGhpcy5fY29tcGlsZU1vZHVsZUFuZENvbXBvbmVudHMobW9kdWxlVHlwZSwgZmFsc2UpKTtcbiAgfVxuXG4gIGNvbXBpbGVNb2R1bGVBbmRBbGxDb21wb25lbnRzU3luYyhtb2R1bGVUeXBlOiBUeXBlKTogTW9kdWxlV2l0aENvbXBvbmVudEZhY3RvcmllcyB7XG4gICAgcmV0dXJuIFN5bmNBc3luYy5hc3NlcnRTeW5jKHRoaXMuX2NvbXBpbGVNb2R1bGVBbmRBbGxDb21wb25lbnRzKG1vZHVsZVR5cGUsIHRydWUpKTtcbiAgfVxuXG4gIGNvbXBpbGVNb2R1bGVBbmRBbGxDb21wb25lbnRzQXN5bmMobW9kdWxlVHlwZTogVHlwZSk6IFByb21pc2U8TW9kdWxlV2l0aENvbXBvbmVudEZhY3Rvcmllcz4ge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUodGhpcy5fY29tcGlsZU1vZHVsZUFuZEFsbENvbXBvbmVudHMobW9kdWxlVHlwZSwgZmFsc2UpKTtcbiAgfVxuXG4gIGdldENvbXBvbmVudEZhY3RvcnkoY29tcG9uZW50OiBUeXBlKTogb2JqZWN0IHtcbiAgICBjb25zdCBzdW1tYXJ5ID0gdGhpcy5fbWV0YWRhdGFSZXNvbHZlci5nZXREaXJlY3RpdmVTdW1tYXJ5KGNvbXBvbmVudCk7XG4gICAgcmV0dXJuIHN1bW1hcnkuY29tcG9uZW50RmFjdG9yeSBhcyBvYmplY3Q7XG4gIH1cblxuICBsb2FkQW90U3VtbWFyaWVzKHN1bW1hcmllczogKCkgPT4gYW55W10pIHtcbiAgICB0aGlzLmNsZWFyQ2FjaGUoKTtcbiAgICB0aGlzLl9hZGRBb3RTdW1tYXJpZXMoc3VtbWFyaWVzKTtcbiAgfVxuXG4gIHByaXZhdGUgX2FkZEFvdFN1bW1hcmllcyhmbjogKCkgPT4gYW55W10pIHtcbiAgICBpZiAodGhpcy5fYWRkZWRBb3RTdW1tYXJpZXMuaGFzKGZuKSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLl9hZGRlZEFvdFN1bW1hcmllcy5hZGQoZm4pO1xuICAgIGNvbnN0IHN1bW1hcmllcyA9IGZuKCk7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBzdW1tYXJpZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgIGNvbnN0IGVudHJ5ID0gc3VtbWFyaWVzW2ldO1xuICAgICAgaWYgKHR5cGVvZiBlbnRyeSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICB0aGlzLl9hZGRBb3RTdW1tYXJpZXMoZW50cnkpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc3Qgc3VtbWFyeSA9IGVudHJ5IGFzIENvbXBpbGVUeXBlU3VtbWFyeTtcbiAgICAgICAgdGhpcy5fc3VtbWFyeVJlc29sdmVyLmFkZFN1bW1hcnkoXG4gICAgICAgICAgICB7c3ltYm9sOiBzdW1tYXJ5LnR5cGUucmVmZXJlbmNlLCBtZXRhZGF0YTogbnVsbCwgdHlwZTogc3VtbWFyeX0pO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGhhc0FvdFN1bW1hcnkocmVmOiBUeXBlKSB7IHJldHVybiAhIXRoaXMuX3N1bW1hcnlSZXNvbHZlci5yZXNvbHZlU3VtbWFyeShyZWYpOyB9XG5cbiAgcHJpdmF0ZSBfZmlsdGVySml0SWRlbnRpZmllcnMoaWRzOiBDb21waWxlSWRlbnRpZmllck1ldGFkYXRhW10pOiBhbnlbXSB7XG4gICAgcmV0dXJuIGlkcy5tYXAobW9kID0+IG1vZC5yZWZlcmVuY2UpLmZpbHRlcigocmVmKSA9PiAhdGhpcy5oYXNBb3RTdW1tYXJ5KHJlZikpO1xuICB9XG5cbiAgcHJpdmF0ZSBfY29tcGlsZU1vZHVsZUFuZENvbXBvbmVudHMobW9kdWxlVHlwZTogVHlwZSwgaXNTeW5jOiBib29sZWFuKTogU3luY0FzeW5jPG9iamVjdD4ge1xuICAgIHJldHVybiBTeW5jQXN5bmMudGhlbih0aGlzLl9sb2FkTW9kdWxlcyhtb2R1bGVUeXBlLCBpc1N5bmMpLCAoKSA9PiB7XG4gICAgICB0aGlzLl9jb21waWxlQ29tcG9uZW50cyhtb2R1bGVUeXBlLCBudWxsKTtcbiAgICAgIHJldHVybiB0aGlzLl9jb21waWxlTW9kdWxlKG1vZHVsZVR5cGUpO1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBfY29tcGlsZU1vZHVsZUFuZEFsbENvbXBvbmVudHMobW9kdWxlVHlwZTogVHlwZSwgaXNTeW5jOiBib29sZWFuKTpcbiAgICAgIFN5bmNBc3luYzxNb2R1bGVXaXRoQ29tcG9uZW50RmFjdG9yaWVzPiB7XG4gICAgcmV0dXJuIFN5bmNBc3luYy50aGVuKHRoaXMuX2xvYWRNb2R1bGVzKG1vZHVsZVR5cGUsIGlzU3luYyksICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbXBvbmVudEZhY3Rvcmllczogb2JqZWN0W10gPSBbXTtcbiAgICAgIHRoaXMuX2NvbXBpbGVDb21wb25lbnRzKG1vZHVsZVR5cGUsIGNvbXBvbmVudEZhY3Rvcmllcyk7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBuZ01vZHVsZUZhY3Rvcnk6IHRoaXMuX2NvbXBpbGVNb2R1bGUobW9kdWxlVHlwZSksXG4gICAgICAgIGNvbXBvbmVudEZhY3RvcmllczogY29tcG9uZW50RmFjdG9yaWVzXG4gICAgICB9O1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBfbG9hZE1vZHVsZXMobWFpbk1vZHVsZTogYW55LCBpc1N5bmM6IGJvb2xlYW4pOiBTeW5jQXN5bmM8YW55PiB7XG4gICAgY29uc3QgbG9hZGluZzogUHJvbWlzZTxhbnk+W10gPSBbXTtcbiAgICBjb25zdCBtYWluTmdNb2R1bGUgPSB0aGlzLl9tZXRhZGF0YVJlc29sdmVyLmdldE5nTW9kdWxlTWV0YWRhdGEobWFpbk1vZHVsZSkgITtcbiAgICAvLyBOb3RlOiBmb3IgcnVudGltZSBjb21waWxhdGlvbiwgd2Ugd2FudCB0byB0cmFuc2l0aXZlbHkgY29tcGlsZSBhbGwgbW9kdWxlcyxcbiAgICAvLyBzbyB3ZSBhbHNvIG5lZWQgdG8gbG9hZCB0aGUgZGVjbGFyZWQgZGlyZWN0aXZlcyAvIHBpcGVzIGZvciBhbGwgbmVzdGVkIG1vZHVsZXMuXG4gICAgdGhpcy5fZmlsdGVySml0SWRlbnRpZmllcnMobWFpbk5nTW9kdWxlLnRyYW5zaXRpdmVNb2R1bGUubW9kdWxlcykuZm9yRWFjaCgobmVzdGVkTmdNb2R1bGUpID0+IHtcbiAgICAgIC8vIGdldE5nTW9kdWxlTWV0YWRhdGEgb25seSByZXR1cm5zIG51bGwgaWYgdGhlIHZhbHVlIHBhc3NlZCBpbiBpcyBub3QgYW4gTmdNb2R1bGVcbiAgICAgIGNvbnN0IG1vZHVsZU1ldGEgPSB0aGlzLl9tZXRhZGF0YVJlc29sdmVyLmdldE5nTW9kdWxlTWV0YWRhdGEobmVzdGVkTmdNb2R1bGUpICE7XG4gICAgICB0aGlzLl9maWx0ZXJKaXRJZGVudGlmaWVycyhtb2R1bGVNZXRhLmRlY2xhcmVkRGlyZWN0aXZlcykuZm9yRWFjaCgocmVmKSA9PiB7XG4gICAgICAgIGNvbnN0IHByb21pc2UgPVxuICAgICAgICAgICAgdGhpcy5fbWV0YWRhdGFSZXNvbHZlci5sb2FkRGlyZWN0aXZlTWV0YWRhdGEobW9kdWxlTWV0YS50eXBlLnJlZmVyZW5jZSwgcmVmLCBpc1N5bmMpO1xuICAgICAgICBpZiAocHJvbWlzZSkge1xuICAgICAgICAgIGxvYWRpbmcucHVzaChwcm9taXNlKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICB0aGlzLl9maWx0ZXJKaXRJZGVudGlmaWVycyhtb2R1bGVNZXRhLmRlY2xhcmVkUGlwZXMpXG4gICAgICAgICAgLmZvckVhY2goKHJlZikgPT4gdGhpcy5fbWV0YWRhdGFSZXNvbHZlci5nZXRPckxvYWRQaXBlTWV0YWRhdGEocmVmKSk7XG4gICAgfSk7XG4gICAgcmV0dXJuIFN5bmNBc3luYy5hbGwobG9hZGluZyk7XG4gIH1cblxuICBwcml2YXRlIF9jb21waWxlTW9kdWxlKG1vZHVsZVR5cGU6IFR5cGUpOiBvYmplY3Qge1xuICAgIGxldCBuZ01vZHVsZUZhY3RvcnkgPSB0aGlzLl9jb21waWxlZE5nTW9kdWxlQ2FjaGUuZ2V0KG1vZHVsZVR5cGUpICE7XG4gICAgaWYgKCFuZ01vZHVsZUZhY3RvcnkpIHtcbiAgICAgIGNvbnN0IG1vZHVsZU1ldGEgPSB0aGlzLl9tZXRhZGF0YVJlc29sdmVyLmdldE5nTW9kdWxlTWV0YWRhdGEobW9kdWxlVHlwZSkgITtcbiAgICAgIC8vIEFsd2F5cyBwcm92aWRlIGEgYm91bmQgQ29tcGlsZXJcbiAgICAgIGNvbnN0IGV4dHJhUHJvdmlkZXJzID0gdGhpcy5nZXRFeHRyYU5nTW9kdWxlUHJvdmlkZXJzKG1vZHVsZU1ldGEudHlwZS5yZWZlcmVuY2UpO1xuICAgICAgY29uc3Qgb3V0cHV0Q3R4ID0gY3JlYXRlT3V0cHV0Q29udGV4dCgpO1xuICAgICAgY29uc3QgY29tcGlsZVJlc3VsdCA9IHRoaXMuX25nTW9kdWxlQ29tcGlsZXIuY29tcGlsZShvdXRwdXRDdHgsIG1vZHVsZU1ldGEsIGV4dHJhUHJvdmlkZXJzKTtcbiAgICAgIG5nTW9kdWxlRmFjdG9yeSA9IHRoaXMuX2ludGVycHJldE9ySml0KFxuICAgICAgICAgIG5nTW9kdWxlSml0VXJsKG1vZHVsZU1ldGEpLCBvdXRwdXRDdHguc3RhdGVtZW50cylbY29tcGlsZVJlc3VsdC5uZ01vZHVsZUZhY3RvcnlWYXJdO1xuICAgICAgdGhpcy5fY29tcGlsZWROZ01vZHVsZUNhY2hlLnNldChtb2R1bGVNZXRhLnR5cGUucmVmZXJlbmNlLCBuZ01vZHVsZUZhY3RvcnkpO1xuICAgIH1cbiAgICByZXR1cm4gbmdNb2R1bGVGYWN0b3J5O1xuICB9XG5cbiAgLyoqXG4gICAqIEBpbnRlcm5hbFxuICAgKi9cbiAgX2NvbXBpbGVDb21wb25lbnRzKG1haW5Nb2R1bGU6IFR5cGUsIGFsbENvbXBvbmVudEZhY3Rvcmllczogb2JqZWN0W118bnVsbCkge1xuICAgIGNvbnN0IG5nTW9kdWxlID0gdGhpcy5fbWV0YWRhdGFSZXNvbHZlci5nZXROZ01vZHVsZU1ldGFkYXRhKG1haW5Nb2R1bGUpICE7XG4gICAgY29uc3QgbW9kdWxlQnlKaXREaXJlY3RpdmUgPSBuZXcgTWFwPGFueSwgQ29tcGlsZU5nTW9kdWxlTWV0YWRhdGE+KCk7XG4gICAgY29uc3QgdGVtcGxhdGVzID0gbmV3IFNldDxDb21waWxlZFRlbXBsYXRlPigpO1xuXG4gICAgY29uc3QgdHJhbnNKaXRNb2R1bGVzID0gdGhpcy5fZmlsdGVySml0SWRlbnRpZmllcnMobmdNb2R1bGUudHJhbnNpdGl2ZU1vZHVsZS5tb2R1bGVzKTtcbiAgICB0cmFuc0ppdE1vZHVsZXMuZm9yRWFjaCgobG9jYWxNb2QpID0+IHtcbiAgICAgIGNvbnN0IGxvY2FsTW9kdWxlTWV0YSA9IHRoaXMuX21ldGFkYXRhUmVzb2x2ZXIuZ2V0TmdNb2R1bGVNZXRhZGF0YShsb2NhbE1vZCkgITtcbiAgICAgIHRoaXMuX2ZpbHRlckppdElkZW50aWZpZXJzKGxvY2FsTW9kdWxlTWV0YS5kZWNsYXJlZERpcmVjdGl2ZXMpLmZvckVhY2goKGRpclJlZikgPT4ge1xuICAgICAgICBtb2R1bGVCeUppdERpcmVjdGl2ZS5zZXQoZGlyUmVmLCBsb2NhbE1vZHVsZU1ldGEpO1xuICAgICAgICBjb25zdCBkaXJNZXRhID0gdGhpcy5fbWV0YWRhdGFSZXNvbHZlci5nZXREaXJlY3RpdmVNZXRhZGF0YShkaXJSZWYpO1xuICAgICAgICBpZiAoZGlyTWV0YS5pc0NvbXBvbmVudCkge1xuICAgICAgICAgIHRlbXBsYXRlcy5hZGQodGhpcy5fY3JlYXRlQ29tcGlsZWRUZW1wbGF0ZShkaXJNZXRhLCBsb2NhbE1vZHVsZU1ldGEpKTtcbiAgICAgICAgICBpZiAoYWxsQ29tcG9uZW50RmFjdG9yaWVzKSB7XG4gICAgICAgICAgICBjb25zdCB0ZW1wbGF0ZSA9XG4gICAgICAgICAgICAgICAgdGhpcy5fY3JlYXRlQ29tcGlsZWRIb3N0VGVtcGxhdGUoZGlyTWV0YS50eXBlLnJlZmVyZW5jZSwgbG9jYWxNb2R1bGVNZXRhKTtcbiAgICAgICAgICAgIHRlbXBsYXRlcy5hZGQodGVtcGxhdGUpO1xuICAgICAgICAgICAgYWxsQ29tcG9uZW50RmFjdG9yaWVzLnB1c2goZGlyTWV0YS5jb21wb25lbnRGYWN0b3J5IGFzIG9iamVjdCk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcbiAgICB0cmFuc0ppdE1vZHVsZXMuZm9yRWFjaCgobG9jYWxNb2QpID0+IHtcbiAgICAgIGNvbnN0IGxvY2FsTW9kdWxlTWV0YSA9IHRoaXMuX21ldGFkYXRhUmVzb2x2ZXIuZ2V0TmdNb2R1bGVNZXRhZGF0YShsb2NhbE1vZCkgITtcbiAgICAgIHRoaXMuX2ZpbHRlckppdElkZW50aWZpZXJzKGxvY2FsTW9kdWxlTWV0YS5kZWNsYXJlZERpcmVjdGl2ZXMpLmZvckVhY2goKGRpclJlZikgPT4ge1xuICAgICAgICBjb25zdCBkaXJNZXRhID0gdGhpcy5fbWV0YWRhdGFSZXNvbHZlci5nZXREaXJlY3RpdmVNZXRhZGF0YShkaXJSZWYpO1xuICAgICAgICBpZiAoZGlyTWV0YS5pc0NvbXBvbmVudCkge1xuICAgICAgICAgIGRpck1ldGEuZW50cnlDb21wb25lbnRzLmZvckVhY2goKGVudHJ5Q29tcG9uZW50VHlwZSkgPT4ge1xuICAgICAgICAgICAgY29uc3QgbW9kdWxlTWV0YSA9IG1vZHVsZUJ5Sml0RGlyZWN0aXZlLmdldChlbnRyeUNvbXBvbmVudFR5cGUuY29tcG9uZW50VHlwZSkgITtcbiAgICAgICAgICAgIHRlbXBsYXRlcy5hZGQoXG4gICAgICAgICAgICAgICAgdGhpcy5fY3JlYXRlQ29tcGlsZWRIb3N0VGVtcGxhdGUoZW50cnlDb21wb25lbnRUeXBlLmNvbXBvbmVudFR5cGUsIG1vZHVsZU1ldGEpKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICBsb2NhbE1vZHVsZU1ldGEuZW50cnlDb21wb25lbnRzLmZvckVhY2goKGVudHJ5Q29tcG9uZW50VHlwZSkgPT4ge1xuICAgICAgICBpZiAoIXRoaXMuaGFzQW90U3VtbWFyeShlbnRyeUNvbXBvbmVudFR5cGUuY29tcG9uZW50VHlwZSkpIHtcbiAgICAgICAgICBjb25zdCBtb2R1bGVNZXRhID0gbW9kdWxlQnlKaXREaXJlY3RpdmUuZ2V0KGVudHJ5Q29tcG9uZW50VHlwZS5jb21wb25lbnRUeXBlKSAhO1xuICAgICAgICAgIHRlbXBsYXRlcy5hZGQoXG4gICAgICAgICAgICAgIHRoaXMuX2NyZWF0ZUNvbXBpbGVkSG9zdFRlbXBsYXRlKGVudHJ5Q29tcG9uZW50VHlwZS5jb21wb25lbnRUeXBlLCBtb2R1bGVNZXRhKSk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuICAgIHRlbXBsYXRlcy5mb3JFYWNoKCh0ZW1wbGF0ZSkgPT4gdGhpcy5fY29tcGlsZVRlbXBsYXRlKHRlbXBsYXRlKSk7XG4gIH1cblxuICBjbGVhckNhY2hlRm9yKHR5cGU6IFR5cGUpIHtcbiAgICB0aGlzLl9jb21waWxlZE5nTW9kdWxlQ2FjaGUuZGVsZXRlKHR5cGUpO1xuICAgIHRoaXMuX21ldGFkYXRhUmVzb2x2ZXIuY2xlYXJDYWNoZUZvcih0eXBlKTtcbiAgICB0aGlzLl9jb21waWxlZEhvc3RUZW1wbGF0ZUNhY2hlLmRlbGV0ZSh0eXBlKTtcbiAgICBjb25zdCBjb21waWxlZFRlbXBsYXRlID0gdGhpcy5fY29tcGlsZWRUZW1wbGF0ZUNhY2hlLmdldCh0eXBlKTtcbiAgICBpZiAoY29tcGlsZWRUZW1wbGF0ZSkge1xuICAgICAgdGhpcy5fY29tcGlsZWRUZW1wbGF0ZUNhY2hlLmRlbGV0ZSh0eXBlKTtcbiAgICB9XG4gIH1cblxuICBjbGVhckNhY2hlKCk6IHZvaWQge1xuICAgIC8vIE5vdGU6IGRvbid0IGNsZWFyIHRoZSBfYWRkZWRBb3RTdW1tYXJpZXMsIGFzIHRoZXkgZG9uJ3QgY2hhbmdlIVxuICAgIHRoaXMuX21ldGFkYXRhUmVzb2x2ZXIuY2xlYXJDYWNoZSgpO1xuICAgIHRoaXMuX2NvbXBpbGVkVGVtcGxhdGVDYWNoZS5jbGVhcigpO1xuICAgIHRoaXMuX2NvbXBpbGVkSG9zdFRlbXBsYXRlQ2FjaGUuY2xlYXIoKTtcbiAgICB0aGlzLl9jb21waWxlZE5nTW9kdWxlQ2FjaGUuY2xlYXIoKTtcbiAgfVxuXG4gIHByaXZhdGUgX2NyZWF0ZUNvbXBpbGVkSG9zdFRlbXBsYXRlKGNvbXBUeXBlOiBUeXBlLCBuZ01vZHVsZTogQ29tcGlsZU5nTW9kdWxlTWV0YWRhdGEpOlxuICAgICAgQ29tcGlsZWRUZW1wbGF0ZSB7XG4gICAgaWYgKCFuZ01vZHVsZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgIGBDb21wb25lbnQgJHtzdHJpbmdpZnkoY29tcFR5cGUpfSBpcyBub3QgcGFydCBvZiBhbnkgTmdNb2R1bGUgb3IgdGhlIG1vZHVsZSBoYXMgbm90IGJlZW4gaW1wb3J0ZWQgaW50byB5b3VyIG1vZHVsZS5gKTtcbiAgICB9XG4gICAgbGV0IGNvbXBpbGVkVGVtcGxhdGUgPSB0aGlzLl9jb21waWxlZEhvc3RUZW1wbGF0ZUNhY2hlLmdldChjb21wVHlwZSk7XG4gICAgaWYgKCFjb21waWxlZFRlbXBsYXRlKSB7XG4gICAgICBjb25zdCBjb21wTWV0YSA9IHRoaXMuX21ldGFkYXRhUmVzb2x2ZXIuZ2V0RGlyZWN0aXZlTWV0YWRhdGEoY29tcFR5cGUpO1xuICAgICAgYXNzZXJ0Q29tcG9uZW50KGNvbXBNZXRhKTtcblxuICAgICAgY29uc3QgaG9zdE1ldGEgPSB0aGlzLl9tZXRhZGF0YVJlc29sdmVyLmdldEhvc3RDb21wb25lbnRNZXRhZGF0YShcbiAgICAgICAgICBjb21wTWV0YSwgKGNvbXBNZXRhLmNvbXBvbmVudEZhY3RvcnkgYXMgYW55KS52aWV3RGVmRmFjdG9yeSk7XG4gICAgICBjb21waWxlZFRlbXBsYXRlID1cbiAgICAgICAgICBuZXcgQ29tcGlsZWRUZW1wbGF0ZSh0cnVlLCBjb21wTWV0YS50eXBlLCBob3N0TWV0YSwgbmdNb2R1bGUsIFtjb21wTWV0YS50eXBlXSk7XG4gICAgICB0aGlzLl9jb21waWxlZEhvc3RUZW1wbGF0ZUNhY2hlLnNldChjb21wVHlwZSwgY29tcGlsZWRUZW1wbGF0ZSk7XG4gICAgfVxuICAgIHJldHVybiBjb21waWxlZFRlbXBsYXRlO1xuICB9XG5cbiAgcHJpdmF0ZSBfY3JlYXRlQ29tcGlsZWRUZW1wbGF0ZShcbiAgICAgIGNvbXBNZXRhOiBDb21waWxlRGlyZWN0aXZlTWV0YWRhdGEsIG5nTW9kdWxlOiBDb21waWxlTmdNb2R1bGVNZXRhZGF0YSk6IENvbXBpbGVkVGVtcGxhdGUge1xuICAgIGxldCBjb21waWxlZFRlbXBsYXRlID0gdGhpcy5fY29tcGlsZWRUZW1wbGF0ZUNhY2hlLmdldChjb21wTWV0YS50eXBlLnJlZmVyZW5jZSk7XG4gICAgaWYgKCFjb21waWxlZFRlbXBsYXRlKSB7XG4gICAgICBhc3NlcnRDb21wb25lbnQoY29tcE1ldGEpO1xuICAgICAgY29tcGlsZWRUZW1wbGF0ZSA9IG5ldyBDb21waWxlZFRlbXBsYXRlKFxuICAgICAgICAgIGZhbHNlLCBjb21wTWV0YS50eXBlLCBjb21wTWV0YSwgbmdNb2R1bGUsIG5nTW9kdWxlLnRyYW5zaXRpdmVNb2R1bGUuZGlyZWN0aXZlcyk7XG4gICAgICB0aGlzLl9jb21waWxlZFRlbXBsYXRlQ2FjaGUuc2V0KGNvbXBNZXRhLnR5cGUucmVmZXJlbmNlLCBjb21waWxlZFRlbXBsYXRlKTtcbiAgICB9XG4gICAgcmV0dXJuIGNvbXBpbGVkVGVtcGxhdGU7XG4gIH1cblxuICBwcml2YXRlIF9jb21waWxlVGVtcGxhdGUodGVtcGxhdGU6IENvbXBpbGVkVGVtcGxhdGUpIHtcbiAgICBpZiAodGVtcGxhdGUuaXNDb21waWxlZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBjb21wTWV0YSA9IHRlbXBsYXRlLmNvbXBNZXRhO1xuICAgIGNvbnN0IGV4dGVybmFsU3R5bGVzaGVldHNCeU1vZHVsZVVybCA9IG5ldyBNYXA8c3RyaW5nLCBDb21waWxlZFN0eWxlc2hlZXQ+KCk7XG4gICAgY29uc3Qgb3V0cHV0Q29udGV4dCA9IGNyZWF0ZU91dHB1dENvbnRleHQoKTtcbiAgICBjb25zdCBjb21wb25lbnRTdHlsZXNoZWV0ID0gdGhpcy5fc3R5bGVDb21waWxlci5jb21waWxlQ29tcG9uZW50KG91dHB1dENvbnRleHQsIGNvbXBNZXRhKTtcbiAgICBjb21wTWV0YS50ZW1wbGF0ZSAhLmV4dGVybmFsU3R5bGVzaGVldHMuZm9yRWFjaCgoc3R5bGVzaGVldE1ldGEpID0+IHtcbiAgICAgIGNvbnN0IGNvbXBpbGVkU3R5bGVzaGVldCA9XG4gICAgICAgICAgdGhpcy5fc3R5bGVDb21waWxlci5jb21waWxlU3R5bGVzKGNyZWF0ZU91dHB1dENvbnRleHQoKSwgY29tcE1ldGEsIHN0eWxlc2hlZXRNZXRhKTtcbiAgICAgIGV4dGVybmFsU3R5bGVzaGVldHNCeU1vZHVsZVVybC5zZXQoc3R5bGVzaGVldE1ldGEubW9kdWxlVXJsICEsIGNvbXBpbGVkU3R5bGVzaGVldCk7XG4gICAgfSk7XG4gICAgdGhpcy5fcmVzb2x2ZVN0eWxlc0NvbXBpbGVSZXN1bHQoY29tcG9uZW50U3R5bGVzaGVldCwgZXh0ZXJuYWxTdHlsZXNoZWV0c0J5TW9kdWxlVXJsKTtcbiAgICBjb25zdCBwaXBlcyA9IHRlbXBsYXRlLm5nTW9kdWxlLnRyYW5zaXRpdmVNb2R1bGUucGlwZXMubWFwKFxuICAgICAgICBwaXBlID0+IHRoaXMuX21ldGFkYXRhUmVzb2x2ZXIuZ2V0UGlwZVN1bW1hcnkocGlwZS5yZWZlcmVuY2UpKTtcbiAgICBjb25zdCB7dGVtcGxhdGU6IHBhcnNlZFRlbXBsYXRlLCBwaXBlczogdXNlZFBpcGVzfSA9XG4gICAgICAgIHRoaXMuX3BhcnNlVGVtcGxhdGUoY29tcE1ldGEsIHRlbXBsYXRlLm5nTW9kdWxlLCB0ZW1wbGF0ZS5kaXJlY3RpdmVzKTtcbiAgICBjb25zdCBjb21waWxlUmVzdWx0ID0gdGhpcy5fdmlld0NvbXBpbGVyLmNvbXBpbGVDb21wb25lbnQoXG4gICAgICAgIG91dHB1dENvbnRleHQsIGNvbXBNZXRhLCBwYXJzZWRUZW1wbGF0ZSwgaXIudmFyaWFibGUoY29tcG9uZW50U3R5bGVzaGVldC5zdHlsZXNWYXIpLFxuICAgICAgICB1c2VkUGlwZXMpO1xuICAgIGNvbnN0IGV2YWxSZXN1bHQgPSB0aGlzLl9pbnRlcnByZXRPckppdChcbiAgICAgICAgdGVtcGxhdGVKaXRVcmwodGVtcGxhdGUubmdNb2R1bGUudHlwZSwgdGVtcGxhdGUuY29tcE1ldGEpLCBvdXRwdXRDb250ZXh0LnN0YXRlbWVudHMpO1xuICAgIGNvbnN0IHZpZXdDbGFzcyA9IGV2YWxSZXN1bHRbY29tcGlsZVJlc3VsdC52aWV3Q2xhc3NWYXJdO1xuICAgIGNvbnN0IHJlbmRlcmVyVHlwZSA9IGV2YWxSZXN1bHRbY29tcGlsZVJlc3VsdC5yZW5kZXJlclR5cGVWYXJdO1xuICAgIHRlbXBsYXRlLmNvbXBpbGVkKHZpZXdDbGFzcywgcmVuZGVyZXJUeXBlKTtcbiAgfVxuXG4gIHByaXZhdGUgX3BhcnNlVGVtcGxhdGUoXG4gICAgICBjb21wTWV0YTogQ29tcGlsZURpcmVjdGl2ZU1ldGFkYXRhLCBuZ01vZHVsZTogQ29tcGlsZU5nTW9kdWxlTWV0YWRhdGEsXG4gICAgICBkaXJlY3RpdmVJZGVudGlmaWVyczogQ29tcGlsZUlkZW50aWZpZXJNZXRhZGF0YVtdKTpcbiAgICAgIHt0ZW1wbGF0ZTogVGVtcGxhdGVBc3RbXSwgcGlwZXM6IENvbXBpbGVQaXBlU3VtbWFyeVtdfSB7XG4gICAgLy8gTm90ZTogISBpcyBvayBoZXJlIGFzIGNvbXBvbmVudHMgYWx3YXlzIGhhdmUgYSB0ZW1wbGF0ZS5cbiAgICBjb25zdCBwcmVzZXJ2ZVdoaXRlc3BhY2VzID0gY29tcE1ldGEudGVtcGxhdGUgIS5wcmVzZXJ2ZVdoaXRlc3BhY2VzO1xuICAgIGNvbnN0IGRpcmVjdGl2ZXMgPVxuICAgICAgICBkaXJlY3RpdmVJZGVudGlmaWVycy5tYXAoZGlyID0+IHRoaXMuX21ldGFkYXRhUmVzb2x2ZXIuZ2V0RGlyZWN0aXZlU3VtbWFyeShkaXIucmVmZXJlbmNlKSk7XG4gICAgY29uc3QgcGlwZXMgPSBuZ01vZHVsZS50cmFuc2l0aXZlTW9kdWxlLnBpcGVzLm1hcChcbiAgICAgICAgcGlwZSA9PiB0aGlzLl9tZXRhZGF0YVJlc29sdmVyLmdldFBpcGVTdW1tYXJ5KHBpcGUucmVmZXJlbmNlKSk7XG4gICAgcmV0dXJuIHRoaXMuX3RlbXBsYXRlUGFyc2VyLnBhcnNlKFxuICAgICAgICBjb21wTWV0YSwgY29tcE1ldGEudGVtcGxhdGUgIS5odG1sQXN0ICEsIGRpcmVjdGl2ZXMsIHBpcGVzLCBuZ01vZHVsZS5zY2hlbWFzLFxuICAgICAgICB0ZW1wbGF0ZVNvdXJjZVVybChuZ01vZHVsZS50eXBlLCBjb21wTWV0YSwgY29tcE1ldGEudGVtcGxhdGUgISksIHByZXNlcnZlV2hpdGVzcGFjZXMpO1xuICB9XG5cbiAgcHJpdmF0ZSBfcmVzb2x2ZVN0eWxlc0NvbXBpbGVSZXN1bHQoXG4gICAgICByZXN1bHQ6IENvbXBpbGVkU3R5bGVzaGVldCwgZXh0ZXJuYWxTdHlsZXNoZWV0c0J5TW9kdWxlVXJsOiBNYXA8c3RyaW5nLCBDb21waWxlZFN0eWxlc2hlZXQ+KSB7XG4gICAgcmVzdWx0LmRlcGVuZGVuY2llcy5mb3JFYWNoKChkZXAsIGkpID0+IHtcbiAgICAgIGNvbnN0IG5lc3RlZENvbXBpbGVSZXN1bHQgPSBleHRlcm5hbFN0eWxlc2hlZXRzQnlNb2R1bGVVcmwuZ2V0KGRlcC5tb2R1bGVVcmwpICE7XG4gICAgICBjb25zdCBuZXN0ZWRTdHlsZXNBcnIgPSB0aGlzLl9yZXNvbHZlQW5kRXZhbFN0eWxlc0NvbXBpbGVSZXN1bHQoXG4gICAgICAgICAgbmVzdGVkQ29tcGlsZVJlc3VsdCwgZXh0ZXJuYWxTdHlsZXNoZWV0c0J5TW9kdWxlVXJsKTtcbiAgICAgIGRlcC5zZXRWYWx1ZShuZXN0ZWRTdHlsZXNBcnIpO1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBfcmVzb2x2ZUFuZEV2YWxTdHlsZXNDb21waWxlUmVzdWx0KFxuICAgICAgcmVzdWx0OiBDb21waWxlZFN0eWxlc2hlZXQsXG4gICAgICBleHRlcm5hbFN0eWxlc2hlZXRzQnlNb2R1bGVVcmw6IE1hcDxzdHJpbmcsIENvbXBpbGVkU3R5bGVzaGVldD4pOiBzdHJpbmdbXSB7XG4gICAgdGhpcy5fcmVzb2x2ZVN0eWxlc0NvbXBpbGVSZXN1bHQocmVzdWx0LCBleHRlcm5hbFN0eWxlc2hlZXRzQnlNb2R1bGVVcmwpO1xuICAgIHJldHVybiB0aGlzLl9pbnRlcnByZXRPckppdChcbiAgICAgICAgc2hhcmVkU3R5bGVzaGVldEppdFVybChyZXN1bHQubWV0YSwgdGhpcy5fc2hhcmVkU3R5bGVzaGVldENvdW50KyspLFxuICAgICAgICByZXN1bHQub3V0cHV0Q3R4LnN0YXRlbWVudHMpW3Jlc3VsdC5zdHlsZXNWYXJdO1xuICB9XG5cbiAgcHJpdmF0ZSBfaW50ZXJwcmV0T3JKaXQoc291cmNlVXJsOiBzdHJpbmcsIHN0YXRlbWVudHM6IGlyLlN0YXRlbWVudFtdKTogYW55IHtcbiAgICBpZiAoIXRoaXMuX2NvbXBpbGVyQ29uZmlnLnVzZUppdCkge1xuICAgICAgcmV0dXJuIGludGVycHJldFN0YXRlbWVudHMoc3RhdGVtZW50cywgdGhpcy5fcmVmbGVjdG9yKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIGppdFN0YXRlbWVudHMoc291cmNlVXJsLCBzdGF0ZW1lbnRzLCB0aGlzLl9yZWZsZWN0b3IsIHRoaXMuX2NvbXBpbGVyQ29uZmlnLmppdERldk1vZGUpO1xuICAgIH1cbiAgfVxufVxuXG5jbGFzcyBDb21waWxlZFRlbXBsYXRlIHtcbiAgcHJpdmF0ZSBfdmlld0NsYXNzOiBGdW5jdGlvbiA9IG51bGwgITtcbiAgaXNDb21waWxlZCA9IGZhbHNlO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgICAgcHVibGljIGlzSG9zdDogYm9vbGVhbiwgcHVibGljIGNvbXBUeXBlOiBDb21waWxlSWRlbnRpZmllck1ldGFkYXRhLFxuICAgICAgcHVibGljIGNvbXBNZXRhOiBDb21waWxlRGlyZWN0aXZlTWV0YWRhdGEsIHB1YmxpYyBuZ01vZHVsZTogQ29tcGlsZU5nTW9kdWxlTWV0YWRhdGEsXG4gICAgICBwdWJsaWMgZGlyZWN0aXZlczogQ29tcGlsZUlkZW50aWZpZXJNZXRhZGF0YVtdKSB7fVxuXG4gIGNvbXBpbGVkKHZpZXdDbGFzczogRnVuY3Rpb24sIHJlbmRlcmVyVHlwZTogYW55KSB7XG4gICAgdGhpcy5fdmlld0NsYXNzID0gdmlld0NsYXNzO1xuICAgICg8UHJveHlDbGFzcz50aGlzLmNvbXBNZXRhLmNvbXBvbmVudFZpZXdUeXBlKS5zZXREZWxlZ2F0ZSh2aWV3Q2xhc3MpO1xuICAgIGZvciAobGV0IHByb3AgaW4gcmVuZGVyZXJUeXBlKSB7XG4gICAgICAoPGFueT50aGlzLmNvbXBNZXRhLnJlbmRlcmVyVHlwZSlbcHJvcF0gPSByZW5kZXJlclR5cGVbcHJvcF07XG4gICAgfVxuICAgIHRoaXMuaXNDb21waWxlZCA9IHRydWU7XG4gIH1cbn1cblxuZnVuY3Rpb24gYXNzZXJ0Q29tcG9uZW50KG1ldGE6IENvbXBpbGVEaXJlY3RpdmVNZXRhZGF0YSkge1xuICBpZiAoIW1ldGEuaXNDb21wb25lbnQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIGBDb3VsZCBub3QgY29tcGlsZSAnJHtpZGVudGlmaWVyTmFtZShtZXRhLnR5cGUpfScgYmVjYXVzZSBpdCBpcyBub3QgYSBjb21wb25lbnQuYCk7XG4gIH1cbn1cblxuZnVuY3Rpb24gY3JlYXRlT3V0cHV0Q29udGV4dCgpOiBPdXRwdXRDb250ZXh0IHtcbiAgY29uc3QgaW1wb3J0RXhwciA9IChzeW1ib2w6IGFueSkgPT5cbiAgICAgIGlyLmltcG9ydEV4cHIoe25hbWU6IGlkZW50aWZpZXJOYW1lKHN5bWJvbCksIG1vZHVsZU5hbWU6IG51bGwsIHJ1bnRpbWU6IHN5bWJvbH0pO1xuICByZXR1cm4ge3N0YXRlbWVudHM6IFtdLCBnZW5GaWxlUGF0aDogJycsIGltcG9ydEV4cHIsIGNvbnN0YW50UG9vbDogbmV3IENvbnN0YW50UG9vbCgpfTtcbn1cbiJdfQ==