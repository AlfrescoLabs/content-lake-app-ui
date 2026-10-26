import { enableProdMode } from '@angular/core';
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';
import { AppModule } from './app/app.module';
import { environment } from './environments/environment';
import { isMsalPopupResponse } from './app/services/microsoft-auth.service';

if (environment.production) {
  enableProdMode();
}

// The Microsoft sign-in popup lands here with its answer in the URL; the opener reads it and closes the window.
if (!isMsalPopupResponse()) {
  platformBrowserDynamic().bootstrapModule(AppModule)
    .catch(err => console.error(err));
}
