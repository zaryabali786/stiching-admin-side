import { ChangeDetectionStrategy, Component, computed, effect, inject, input, model, signal, untracked } from '@angular/core';
import { GeoService, POPULAR_COUNTRIES } from '../../core/services/geo.service';

/**
 * Country → state → city, one after the other:
 *   - the State field appears only after a country is chosen, with that country's states;
 *   - the City field appears only after a state is chosen, with that state's cities.
 * A country with no states goes straight to its cities. When the address list cannot be loaded (offline, API down) the field becomes a
 * plain text box, so nobody is ever stuck. Choosing a country clears the state and city; choosing a state clears the city.
 * A saved address (country + city, no state) finds its state by itself.
 *
 *   <app-geo-picker [(country)]="country" [(state)]="state" [(city)]="city" [countryError]="..." [cityError]="..." idPrefix="reg" />
 */
@Component({
  selector: 'app-geo-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="field">
      <label [attr.for]="idPrefix() + '-country'">Country</label>
      @if (countriesFailed()) {
        <input [id]="idPrefix() + '-country'" class="input" autocomplete="country-name" placeholder="Type your country" [class.invalid]="!!countryError()" [value]="country()" (input)="onCountry($any($event.target).value)" />
        <span class="hint">The country list could not be loaded, so please type it.</span>
      } @else {
        <select [id]="idPrefix() + '-country'" class="select" autocomplete="country-name" [disabled]="disabled() || loadingCountries()" [class.invalid]="!!countryError()" (change)="onCountry($any($event.target).value)">
          <option value="" [selected]="!country()" disabled>{{ loadingCountries() ? 'Loading countries…' : 'Choose your country' }}</option>
          @if (savedCountryMissing()) { <option [value]="country()" selected>{{ country() }}</option> }
          @if (popular().length) {
            <optgroup label="Popular">
              @for (c of popular(); track c) { <option [value]="c" [selected]="c === country()">{{ c }}</option> }
            </optgroup>
          }
          <optgroup label="All countries">
            @for (c of countries(); track c) { <option [value]="c" [selected]="c === country()">{{ c }}</option> }
          </optgroup>
        </select>
      }
      @if (countryError()) { <span class="field-error">{{ countryError() }}</span> }
    </div>

    @if (showState()) {
      <div class="field">
        <label [attr.for]="idPrefix() + '-state'">State / province</label>
        <select [id]="idPrefix() + '-state'" class="select" autocomplete="address-level1" [disabled]="disabled() || loadingStates()" [class.invalid]="!!stateError()" (change)="onState($any($event.target).value)">
          <option value="" [selected]="!state()" disabled>{{ loadingStates() ? 'Loading states…' : resolving() ? 'Finding your state…' : 'Choose your state' }}</option>
          @for (s of states(); track s) { <option [value]="s" [selected]="s === state()">{{ s }}</option> }
        </select>
        @if (stateError()) { <span class="field-error">{{ stateError() }}</span> }
        @if (city() && !state() && !resolving() && !loadingStates()) { <span class="hint">Saved city: {{ city() }}. Choose your state to change it.</span> }
      </div>
    }

    @if (showCity()) {
      <div class="field">
        <label [attr.for]="idPrefix() + '-city'">City</label>
        @if (cityAsText()) {
          <input [id]="idPrefix() + '-city'" class="input" autocomplete="address-level2" placeholder="Type your city" [class.invalid]="!!cityError()" [disabled]="disabled()" [value]="city()" (input)="city.set($any($event.target).value)" />
          @if (citiesFailed()) { <span class="hint">The city list could not be loaded, so please type it.</span> }
        } @else {
          <select [id]="idPrefix() + '-city'" class="select" autocomplete="address-level2" [disabled]="disabled() || !citiesReady()" [class.invalid]="!!cityError()" (change)="city.set($any($event.target).value)">
            <option value="" [selected]="!city()" disabled>{{ !citiesReady() ? 'Loading cities…' : 'Choose your city' }}</option>
            @for (c of cityOptions(); track c) { <option [value]="c" [selected]="c === city()">{{ c }}</option> }
          </select>
        }
        @if (cityError()) { <span class="field-error">{{ cityError() }}</span> }
      </div>
    }
  `,
  styles: [`:host { display: contents; }`],
})
export class GeoPickerComponent {
  private geo = inject(GeoService);

  readonly country = model('');
  readonly state = model('');
  readonly city = model('');
  /** Unique ids for the three fields, so their labels work when two pickers are on one screen. */
  readonly idPrefix = input('geo');
  readonly disabled = input(false);
  readonly countryError = input<string | null>(null);
  readonly stateError = input<string | null>(null);
  readonly cityError = input<string | null>(null);

  readonly countries = signal<string[]>([]);
  readonly states = signal<string[]>([]);
  readonly cities = signal<string[]>([]);
  readonly loadingCountries = signal(true);
  readonly loadingStates = signal(false);
  readonly loadingCities = signal(false);
  readonly countriesFailed = signal(false);
  readonly statesFailed = signal(false);
  readonly citiesFailed = signal(false);
  readonly resolving = signal(false);
  /** The country the loaded states belong to (so a late answer for another country is ignored). */
  private statesFor = signal('');

  readonly popular = computed(() => POPULAR_COUNTRIES.filter((c) => this.countries().includes(c)));
  readonly savedCountryMissing = computed(() => !!this.country() && !this.countriesFailed() && !this.loadingCountries() && !this.countries().includes(this.country()));

  /** A country with states: the state list; a country without any goes straight to cities. */
  readonly countryHasStates = computed(() => this.statesFor() === this.country() && this.states().length > 0);
  readonly statesLoaded = computed(() => !!this.country() && this.statesFor() === this.country() && !this.loadingStates());
  readonly showState = computed(() => !!this.country() && !this.statesFailed() && (this.loadingStates() || this.countryHasStates()));
  readonly showCity = computed(() => {
    if (!this.country()) return false;
    if (this.state()) return true;
    // no states for this country (or the list failed): the city list of the whole country
    return this.statesLoaded() && (!this.countryHasStates() || this.statesFailed());
  });
  /** Which list the loaded cities belong to ("country|state"), so a list for a different state is never shown or judged empty. */
  private readonly citiesKey = signal('');
  private readonly wantedKey = computed(() => `${this.country()}|${this.state()}`);
  readonly citiesReady = computed(() => this.citiesKey() === this.wantedKey() && !this.loadingCities());
  readonly cityAsText = computed(() => this.citiesFailed() || (this.citiesReady() && this.cities().length === 0));
  readonly cityOptions = computed(() => {
    const list = this.cities();
    const c = this.city();
    return c && !list.includes(c) ? [c, ...list] : list;
  });

  private statesToken = 0;
  private citiesToken = 0;
  private resolvedFor = '';

  constructor() {
    this.geo
      .countries()
      .then((list) => this.countries.set(list))
      .catch(() => this.countriesFailed.set(true))
      .finally(() => this.loadingCountries.set(false));

    // the country decides the states (also for a saved country)
    effect(() => {
      const country = this.country();
      untracked(() => void this.loadStates(country));
    });

    // the state (or, without states, the country) decides the cities
    effect(() => {
      const country = this.country();
      const state = this.state();
      const ready = this.statesLoaded();
      const hasStates = this.countryHasStates();
      const failed = this.statesFailed();
      untracked(() => {
        if (!country || !ready) return;
        if (state) void this.loadCities(country, state);
        else if (!hasStates || failed) void this.loadCities(country, null);
        else this.cities.set([]);
      });
    });
  }

  onCountry(value: string): void {
    if (value === this.country()) return;
    this.state.set('');
    this.city.set('');
    this.country.set(value.trim());
  }

  onState(value: string): void {
    if (value === this.state()) return;
    this.city.set('');
    this.state.set(value);
  }

  private async loadStates(country: string): Promise<void> {
    const token = ++this.statesToken;
    this.states.set([]);
    this.statesFailed.set(false);
    this.statesFor.set('');
    if (!country) {
      this.loadingStates.set(false);
      return;
    }
    this.loadingStates.set(true);
    try {
      const list = await this.geo.states(country);
      if (token !== this.statesToken) return;
      this.states.set(list);
      this.statesFor.set(country);
      this.loadingStates.set(false);
      void this.resolveSavedState(country, list);
    } catch {
      if (token !== this.statesToken) return;
      this.statesFailed.set(true);
      this.statesFor.set(country);
      this.loadingStates.set(false);
    }
  }

  private async loadCities(country: string, state: string | null): Promise<void> {
    const token = ++this.citiesToken;
    this.cities.set([]);
    this.citiesFailed.set(false);
    this.loadingCities.set(true);
    try {
      const list = await this.geo.cities(country, state);
      if (token !== this.citiesToken) return;
      this.cities.set(list);
      this.citiesKey.set(`${country}|${state ?? ''}`);
    } catch {
      if (token !== this.citiesToken) return;
      this.citiesFailed.set(true);
    } finally {
      if (token === this.citiesToken) this.loadingCities.set(false);
    }
  }

  /** A saved address has a country and a city but no state: look for the state whose cities include the city (a few requests, then cached). */
  private async resolveSavedState(country: string, states: string[]): Promise<void> {
    const city = this.city().trim();
    const key = `${country}|${city}`;
    if (!city || this.state() || !states.length || this.resolvedFor === key) return;
    this.resolvedFor = key;
    this.resolving.set(true);
    try {
      const target = city.toLowerCase();
      const queue = [...states];
      let found: string | null = null;
      const worker = async () => {
        while (!found && queue.length) {
          const s = queue.shift()!;
          try {
            const list = await this.geo.cities(country, s);
            if (list.some((c) => c.toLowerCase() === target)) found = s;
          } catch {
            /* one state failing does not stop the search */
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(6, states.length) }, worker));
      // still the same country and nobody chose a state meanwhile
      if (found && this.country() === country && !this.state()) this.state.set(found);
    } finally {
      this.resolving.set(false);
    }
  }
}
