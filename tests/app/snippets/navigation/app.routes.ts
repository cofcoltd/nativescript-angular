// >> router-config-all
import { Routes } from "@angular/router";
import { FirstComponent, SecondComponent } from "./navigation-common";

export const routes: Routes = [
    { path: "", redirectTo: "/first", pathMatch: "full" },
    { path: "first", component: FirstComponent },
    { path: "second", component: SecondComponent }
];
// << router-config-all
