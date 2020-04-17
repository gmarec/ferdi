import { ThemeType } from '@meetfranz/theme';
import {
  computed,
  action,
  observable,
} from 'mobx';
import localStorage from 'mobx-localstorage';

import { todoActions } from './actions';
import { FeatureStore } from '../utils/FeatureStore';
import { createReactions } from '../../stores/lib/Reaction';
import { createActionBindings } from '../utils/ActionBinding';
import {
  DEFAULT_TODOS_WIDTH, TODOS_MIN_WIDTH, DEFAULT_TODOS_VISIBLE, TODOS_ROUTES, DEFAULT_IS_FEATURE_ENABLED_BY_USER,
} from '.';
import { IPC } from './constants';
import { state as delayAppState } from '../delayApp';

const debug = require('debug')('Ferdi:feature:todos:store');

export default class TodoStore extends FeatureStore {
  @observable isFeatureEnabled = false;

  @observable isFeatureActive = false;

  webview = null;

  @computed get width() {
    const width = this.settings.width || DEFAULT_TODOS_WIDTH;

    return width < TODOS_MIN_WIDTH ? TODOS_MIN_WIDTH : width;
  }

  @computed get isTodosPanelForceHidden() {
    const { isAnnouncementShown } = this.stores.announcements;
    return delayAppState.isDelayAppScreenVisible || !this.isFeatureEnabledByUser || isAnnouncementShown;
  }

  @computed get isTodosPanelVisible() {
    if (this.settings.isTodosPanelVisible === undefined) return DEFAULT_TODOS_VISIBLE;
    return this.settings.isTodosPanelVisible;
  }

  @computed get isFeatureEnabledByUser() {
    return this.settings.isFeatureEnabledByUser;
  }

  @computed get settings() {
    return localStorage.getItem('todos') || {};
  }

  // ========== PUBLIC API ========= //

  @action start(stores, actions) {
    debug('TodoStore::start');
    this.stores = stores;
    this.actions = actions;

    // ACTIONS

    this._registerActions(createActionBindings([
      [todoActions.resize, this._resize],
      [todoActions.toggleTodosPanel, this._toggleTodosPanel],
      [todoActions.setTodosWebview, this._setTodosWebview],
      [todoActions.handleHostMessage, this._handleHostMessage],
      [todoActions.handleClientMessage, this._handleClientMessage],
      [todoActions.toggleTodosFeatureVisibility, this._toggleTodosFeatureVisibility],
    ]));

    // REACTIONS

    this._allReactions = createReactions([
      this._setFeatureEnabledReaction,
      this._updateTodosConfig,
      this._firstLaunchReaction,
      this._routeCheckReaction,
    ]);

    this._registerReactions(this._allReactions);

    this.isFeatureActive = true;

    if (this.settings.isFeatureEnabledByUser === undefined) {
      this._updateSettings({
        isFeatureEnabledByUser: DEFAULT_IS_FEATURE_ENABLED_BY_USER,
      });
    }
  }

  @action stop() {
    super.stop();
    debug('TodoStore::stop');
    this.reset();
    this.isFeatureActive = false;
  }

  // ========== PRIVATE METHODS ========= //

  _updateSettings = (changes) => {
    localStorage.setItem('todos', {
      ...this.settings,
      ...changes,
    });
  };

  // Actions

  @action _resize = ({ width }) => {
    this._updateSettings({
      width,
    });
  };

  @action _toggleTodosPanel = () => {
    this._updateSettings({
      isTodosPanelVisible: !this.isTodosPanelVisible,
    });
  };

  @action _setTodosWebview = ({ webview }) => {
    debug('_setTodosWebview', webview);
    this.webview = webview;
  };

  @action _handleHostMessage = (message) => {
    debug('_handleHostMessage', message);
    if (message.action === 'todos:create') {
      this.webview.send(IPC.TODOS_HOST_CHANNEL, message);
    }
  };

  @action _handleClientMessage = (message) => {
    debug('_handleClientMessage', message);
    switch (message.action) {
      case 'todos:initialized': this._onTodosClientInitialized(); break;
      case 'todos:goToService': this._goToService(message.data); break;
      default:
        debug('Unknown client message reiceived', message);
    }
  };

  @action _toggleTodosFeatureVisibility = () => {
    debug('_toggleTodosFeatureVisibility');

    this._updateSettings({
      isFeatureEnabledByUser: !this.settings.isFeatureEnabledByUser,
    });
  };

  // Todos client message handlers

  _onTodosClientInitialized = () => {
    const { authToken } = this.stores.user;
    const { isDarkThemeActive } = this.stores.ui;
    const { locale } = this.stores.app;
    if (!this.webview) return;
    this.webview.send(IPC.TODOS_HOST_CHANNEL, {
      action: 'todos:configure',
      data: {
        authToken,
        locale,
        theme: isDarkThemeActive ? ThemeType.dark : ThemeType.default,
      },
    });

    this.webview.addEventListener('new-window', ({ url }) => {
      this.actions.app.openExternalUrl({ url });
    });
  };

  _goToService = ({ url, serviceId, serviceName }) => {
    if (serviceId) {
      if (url) {
        this.stores.services.one(serviceId).webview.loadURL(url);
      }
      this.actions.service.setActive({ serviceId });
    } else if (serviceName) {
      let searchServiceId = 'not-found';
      this.stores.services.allDisplayed.forEach((s) => {
        if (s.name === serviceName) {
          searchServiceId = s.id;
        }
      });
      if (searchServiceId !== 'not-found') {
        if (url) {
          this.stores.services.one(searchServiceId).webview.loadURL(url);
        }
        this.actions.service.setActive({ searchServiceId });
      }
    }
  };

  // Reactions

  _setFeatureEnabledReaction = () => {
    const { isTodosEnabled } = this.stores.features.features;

    this.isFeatureEnabled = isTodosEnabled;
  };

  _updateTodosConfig = () => {
    // Resend the config if any part changes in Franz:
    this._onTodosClientInitialized();
  };

  _firstLaunchReaction = () => {
    const { stats } = this.stores.settings.all;

    // Hide todos layer on first app start but show on second
    if (stats.appStarts <= 1) {
      this._updateSettings({
        isTodosPanelVisible: false,
      });
    } else if (stats.appStarts <= 2) {
      this._updateSettings({
        isTodosPanelVisible: true,
      });
    }
  };

  _routeCheckReaction = () => {
    const { pathname } = this.stores.router.location;

    if (pathname === TODOS_ROUTES.TARGET) {
      debug('Router is on todos route, show todos panel');
      // todosStore.start(stores, actions);
      this.stores.router.push('/');

      if (!this.isTodosPanelVisible) {
        this._updateSettings({
          isTodosPanelVisible: true,
        });
      }
    }
  }
}
