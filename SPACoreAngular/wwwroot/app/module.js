"use strict";var __decorate=this&&this.__decorate||function(o,e,t,r){var n,p=arguments.length,c=p<3?e:null===r?r=Object.getOwnPropertyDescriptor(e,t):r;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)c=Reflect.decorate(o,e,t,r);else for(var m=o.length-1;0<=m;m--)(n=o[m])&&(c=(p<3?n(c):3<p?n(e,t,c):n(e,t))||c);return 3<p&&c&&Object.defineProperty(e,t,c),c};Object.defineProperty(exports,"__esModule",{value:!0});var core_1=require("@angular/core"),platform_browser_1=require("@angular/platform-browser"),router_1=require("@angular/router"),forms_1=require("@angular/forms"),component_1=require("./component/app/component"),component_2=require("./component/home/component"),component_3=require("./component/about/component"),component_4=require("./component/user/component"),routes=[{path:"",redirectTo:"home",pathMatch:"full"},{path:"home",component:component_2.HomeComponent},{path:"about",component:component_3.AboutComponent},{path:"user",component:component_4.UserComponent}],AppModule=function(){function o(){}return o=__decorate([core_1.NgModule({declarations:[component_1.AppComponent,component_2.HomeComponent,component_3.AboutComponent,component_4.UserComponent],imports:[platform_browser_1.BrowserModule,forms_1.FormsModule,forms_1.ReactiveFormsModule,router_1.RouterModule.forRoot(routes)],bootstrap:[component_1.AppComponent]})],o)}();exports.AppModule=AppModule;