import Sinon from 'sinon';
import {
  restoreSignInState,
  signIn,
  cancelSignIn,
  attemptId,
  AttemptStateMap,
  performSignInAttempt,
} from './atlas-signin-reducer';
import { expect } from 'chai';
import { configureStore } from './atlas-signin-store';

describe('atlasSignInReducer', function () {
  const sandbox = Sinon.createSandbox();

  afterEach(function () {
    sandbox.reset();
  });

  describe('restoreSignInState', function () {
    it('should check authentication and set state to success if authenticated', async function () {
      const mockAtlasService = {
        isAuthenticated: sandbox.stub().resolves(true),
        getUserInfo: sandbox.stub().resolves({ sub: '1234' }),
      };
      const store = configureStore({
        atlasAuthService: mockAtlasService as any,
      });
      await store.dispatch(restoreSignInState());
      expect(mockAtlasService.isAuthenticated).to.have.been.calledOnce;
      expect(store.getState()).to.have.nested.property('state', 'success');
    });

    it('should set state to unauthenticated if not authenticated', async function () {
      const mockAtlasService = {
        isAuthenticated: sandbox.stub().resolves(false),
      };
      const store = configureStore({
        atlasAuthService: mockAtlasService as any,
      });
      await store.dispatch(restoreSignInState());
      expect(store.getState()).to.have.nested.property(
        'state',
        'unauthenticated'
      );
    });

    it('should set state to unauthenticated if check fails', async function () {
      const mockAtlasService = {
        isAuthenticated: sandbox.stub().rejects(new Error('Whoops!')),
      };
      const store = configureStore({
        atlasAuthService: mockAtlasService as any,
      });
      await store.dispatch(restoreSignInState());
      expect(store.getState()).to.have.nested.property(
        'state',
        'unauthenticated'
      );
    });

    it('should do nothing if user initiated sign in while restore was in progress', async function () {
      let resolve: (val?: unknown) => void = () => {};
      const promise = new Promise((res) => {
        resolve = res;
      });
      // We are simulating a situation where we started state restoration, but
      // while isAuthenticated check was inflight, user manually went through
      // sign in flow that ended successfully
      const mockAtlasService = {
        isAuthenticated: sandbox
          .stub()
          .onFirstCall()
          .returns(promise)
          .onSecondCall()
          .resolves(true),
        getUserInfo: sandbox.stub().resolves({ sub: '1234' }),
        emit: sandbox.stub(),
      };
      const store = configureStore({
        atlasAuthService: mockAtlasService as any,
      });
      const restorePromise = store.dispatch(restoreSignInState());
      expect(mockAtlasService.isAuthenticated).to.have.been.calledOnce;
      expect(store.getState()).to.have.nested.property('state', 'restoring');
      await store.dispatch(signIn());
      expect(mockAtlasService.isAuthenticated).to.have.been.calledTwice;
      expect(store.getState()).to.have.nested.property('state', 'success');
      // Intentionally returning false here so that if action would affect
      // state, the state values would unexpectedly change
      resolve(false);
      await restorePromise;
      expect(store.getState()).to.have.nested.property('state', 'success');
    });
  });

  describe('signIn', function () {
    it('should check authenticated state and set state to success if already autenticated', async function () {
      const mockAtlasService = {
        isAuthenticated: sandbox.stub().resolves(true),
        signIn: sandbox.stub().resolves({ sub: '1234' }),
        getUserInfo: sandbox.stub().resolves({ sub: '1234' }),
        emit: sandbox.stub(),
      };
      const store = configureStore({
        atlasAuthService: mockAtlasService as any,
      });

      await store.dispatch(signIn());
      expect(mockAtlasService.isAuthenticated).to.have.been.calledOnce;
      expect(mockAtlasService.signIn).not.to.have.been.called;
      expect(store.getState()).to.have.nested.property('state', 'success');
    });

    it('should check authenticated state, start sign in, and set state to success', async function () {
      const mockAtlasService = {
        isAuthenticated: sandbox.stub().resolves(false),
        signIn: sandbox.stub().resolves({ sub: '1234' }),
        getUserInfo: sandbox.stub().resolves({ sub: '1234' }),
        emit: sandbox.stub(),
      };
      const store = configureStore({
        atlasAuthService: mockAtlasService as any,
      });

      await store.dispatch(signIn());
      expect(mockAtlasService.isAuthenticated).to.have.been.calledOnce;
      expect(mockAtlasService.signIn).to.have.been.calledOnce;
      expect(store.getState()).to.have.nested.property('state', 'success');
    });

    it('should fail sign in if sign in failed', async function () {
      const mockAtlasService = {
        isAuthenticated: sandbox.stub().resolves(false),
        signIn: sandbox.stub().rejects(new Error('Whooops!')),
      };
      const store = configureStore({
        atlasAuthService: mockAtlasService as any,
      });

      const signInPromise = store.dispatch(signIn());
      // Avoid unhandled rejections
      AttemptStateMap.get(attemptId)?.promise.catch(() => {});
      await signInPromise;
      expect(mockAtlasService.isAuthenticated).to.have.been.calledOnce;
      expect(mockAtlasService.signIn).to.have.been.calledOnce;
      expect(store.getState()).to.have.nested.property('state', 'error');
    });
  });

  describe('cancelSignIn', function () {
    it('should do nothing if no sign in is in progress', function () {
      const store = configureStore({
        atlasAuthService: {} as any,
      });
      expect(store.getState()).to.have.nested.property('state', 'initial');
      store.dispatch(cancelSignIn());
      expect(store.getState()).to.have.nested.property('state', 'initial');
    });

    it('should cancel sign in if sign in is in progress', async function () {
      const isAuthenticatedStub = sandbox
        .stub()
        .callsFake(({ signal }: { signal: AbortSignal }) => {
          return new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => {
              reject(signal.reason);
            });
          });
        });
      const mockAtlasService = {
        isAuthenticated: isAuthenticatedStub,
      };
      const store = configureStore({
        atlasAuthService: mockAtlasService as any,
      });

      void store.dispatch(performSignInAttempt()).catch(() => {});

      // Give it some time for start the sign in attempt. It will be waiting
      // at isAuthenticated, which never resolves.
      await new Promise((resolve) => setTimeout(resolve, 100));
      store.dispatch(cancelSignIn());
      expect(store.getState()).to.have.nested.property('state', 'canceled');

      expect(isAuthenticatedStub).to.have.been.calledOnce;
    });
  });

  describe('performSignInAttempt', function () {
    it('should resolve when sign in flow finishes', async function () {
      const mockAtlasService = {
        isAuthenticated: sandbox.stub().resolves(false),
        signIn: sandbox.stub().resolves({ sub: '1234' }),
        getUserInfo: sandbox.stub().resolves({ sub: '1234' }),
        emit: sandbox.stub(),
      };
      const store = configureStore({
        atlasAuthService: mockAtlasService as any,
      });
      await store.dispatch(performSignInAttempt());
      expect(store.getState()).to.have.property('state', 'success');
    });

    it('should reject if sign in fails', async function () {
      const mockAtlasService = {
        isAuthenticated: sandbox.stub().resolves(false),
        signIn: sandbox.stub().rejects(new Error('Sign in failed')),
        getUserInfo: sandbox.stub().resolves({ sub: '1234' }),
        emit: sandbox.stub(),
      };
      const store = configureStore({
        atlasAuthService: mockAtlasService as any,
      });
      try {
        await store.dispatch(performSignInAttempt());
        expect.fail('Expected performSignInAttempt action to throw');
      } catch (err) {
        expect(err).to.have.property('message', 'Sign in failed');
      }
      expect(store.getState()).to.have.property('state', 'error');
    });

    it('should reject if provided signal was aborted', async function () {
      let resolveSignInCalled = () => {};
      const signInCalled: Promise<void> = new Promise(
        (resolve) => (resolveSignInCalled = resolve)
      );
      const mockAtlasService = {
        isAuthenticated: sandbox.stub().resolves(false),
        signIn: sandbox.stub().callsFake(() => {
          resolveSignInCalled();
          return { sub: '1234' };
        }),
        getUserInfo: sandbox.stub().resolves({ sub: '1234' }),
        emit: sandbox.stub(),
      };
      const store = configureStore({
        atlasAuthService: mockAtlasService as any,
      });
      const c = new AbortController();
      const signInPromise = store.dispatch(
        performSignInAttempt({ signal: c.signal })
      );
      c.abort(new Error('Aborted from outside'));
      try {
        await signInPromise;
        throw new Error('Expected signInPromise to throw');
      } catch (err) {
        expect(err).to.have.property('message', 'Aborted from outside');
      }
      expect(store.getState()).to.have.property('state', 'canceled');

      // Ensure that we are not leaving a dangling store operation that would conflict with our mocks being reset.
      await signInCalled;
    });
  });
});
