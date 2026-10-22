import { BehaviorSubject } from 'rxjs';
import { AuthService } from './auth.service';
import { ChatSessionService } from './chat-session.service';
import { ChatMessage } from './rag.service';

describe('ChatSessionService', () => {
  const KEY = 'content-lake.chat.sessions.v1';
  let owner$: BehaviorSubject<string>;

  function authAs(owner: string): AuthService {
    owner$ = new BehaviorSubject<string>(owner);
    return { ready: Promise.resolve(), owner$ } as unknown as AuthService;
  }

  async function serviceFor(owner: string): Promise<ChatSessionService> {
    const service = new ChatSessionService(authAs(owner));
    await Promise.resolve();
    await Promise.resolve();
    return service;
  }

  function message(content: string): ChatMessage {
    return { id: content, role: 'user', content, timestamp: new Date() } as ChatMessage;
  }

  beforeEach(() => sessionStorage.clear());
  afterEach(() => sessionStorage.clear());

  it('keepsTheHistoryAcrossAReloadForTheSameUser', async () => {
    const first = await serviceFor('jim');
    first.saveMessages(first.ensureActiveSession(), [message('Lakeside?')]);

    const reloaded = await serviceFor('jim');

    expect(reloaded.listSessions().length).toBe(1);
    expect(reloaded.getMessages(reloaded.ensureActiveSession())[0].content).toBe('Lakeside?');
  });

  it('wipesTheHistoryWhenEveryoneSignsOut', async () => {
    const service = await serviceFor('jim');
    service.saveMessages(service.ensureActiveSession(), [message('Lakeside?')]);
    let cleared = 0;
    service.cleared$.subscribe(() => cleared++);

    owner$.next('');

    expect(service.listSessions().length).toBe(0);
    expect(cleared).toBe(1);
  });

  it('neverShowsOneUsersHistoryToAnother', async () => {
    const service = await serviceFor('jim');
    service.saveMessages(service.ensureActiveSession(), [message('Lakeside?')]);

    owner$.next('michael');

    expect(service.listSessions().length).toBe(0);
    expect(sessionStorage.getItem(KEY)).not.toContain('Lakeside?');
  });

  it('discardsAStoredHistoryThatBelongsToSomeoneElse', async () => {
    const jim = await serviceFor('jim');
    jim.saveMessages(jim.ensureActiveSession(), [message('Lakeside?')]);

    const michael = await serviceFor('michael');

    expect(michael.listSessions().length).toBe(0);
  });

  it('keepsTheHistoryWhenTheSameUserSignsInToASecondRepository', async () => {
    const service = await serviceFor('jim');
    service.saveMessages(service.ensureActiveSession(), [message('Lakeside?')]);

    // Two repositories, one person: the owner is still 'jim'.
    owner$.next('jim');

    expect(service.listSessions().length).toBe(1);
  });
});
