'use strict';

type Callback = (action:string, payload:object, handler:string) => void|object|Promise<object>

type ActionCallback = {
    action: string;
    callback: Callback;
};

type Response = {
    handle: string;
    request: string;
    deferred: Function;
};

type RequestResponder = {
    handle: string;
    response: any;
    error?: string;
    timeout?: boolean;
}

type AwaitingResponses = {
    [key: number]: Response;
};

type AwaitingAcks = {
    [key: number]: Function;
};

type MBEventDetail = {
    _source: string;
    action: string;
    payload: any;
    from: string;
    to: string;
    isResponse: boolean;
    expectsResponse: boolean;
    isAck: boolean;
    ackCode: number;
    responseCode: number;
}

type WindowHandles = {
    [key: string]: Window
}

/**
 * @class
 * @classdesc A cross window/frame messaging system
 */
export class MessagingBus {
    private localHandle:string;
    private callbacks:ActionCallback[] = [];
    private awaitingResponse:AwaitingResponses = {};
    private awaitingAcknowledgement:AwaitingAcks = {};
    private windowHandles:WindowHandles = {};
    private directDescendants:string[] = [];
    private waitHandles:number[] = [];
    private boundListener:(event:MessageEvent) => void;
    private boundDestroy:(event:MessageEvent) => void;

    public static INTERNAL_ACTIONS = {
        register: '__INTERNAL_MESSAGING_REGISTRATION',
        deregister: '__INTERNAL_MESSAGING_DEREGISTRATION',
        distribute: '__INTERNAL_MESSAGING_DISTRIBUTION'
    };

    /**
     * @param {string} [handle=main] - a name to register this window under, this wil be used for message/request targeting, so all windows must register unique names
     */
    constructor(handle: string = window.name || 'main') {
        this.boundListener = this.listener.bind(this);
        this.boundDestroy = this.destroy.bind(this);

        window.addEventListener('message', this.boundListener);
        window.addEventListener('beforeunload', this.boundDestroy);

        this.localHandle = handle;

        if(window.opener) {
            this.distributeHandle(window.opener.top);
        }
        
        if(window.top) {
            this.distributeHandle(window.top)
        } else {
            this.distributeHandle(window);
        }
    }

    private distributeHandle(top: Window) : void {
        console.log('dist', top);

        this.iterateWindowFrames(top, (w: Window) => {
            const payload = {
                isChild: w === window.parent,
            };

            this.sendToContentWindow(w, {
                action: MessagingBus.INTERNAL_ACTIONS.register,
                payload,
                from: this.localHandle
            });
            this.log('internal', 'REGISTRATION', payload);
        });

        const payload = {
            isChild: top === window.parent,
        };

        this.sendToContentWindow(top, {
            action: MessagingBus.INTERNAL_ACTIONS.register,
            payload,
            from: this.localHandle
        });

        this.log('internal','REGISTRATION', payload);
    }

    private iterateWindowFrames(w:Window, iterator:Function) : void {
        for(let i = 0; i < w.frames.length; i++) {
            const frame = w.frames[i];
            iterator(frame);
            this.iterateWindowFrames(frame, iterator);
        }
    }

    private listener(event:MessageEvent<MBEventDetail>) : void | Promise<void> {
        const {
            _source,
            action,
            payload,
            from,
            to,
            isResponse = false,
            expectsResponse = false,
            isAck = false,
            ackCode,
            responseCode
        } = event.data;

        if(_source !== '__MessagingBus__') {
            //its not intended for us
            return;
        }

        if (Object.values(MessagingBus.INTERNAL_ACTIONS).includes(action)) {
            return this.internalActions(event);
        }

        if (to !== this.localHandle) {
            //its not ment for us
            return;
        }

        if (event.source !== this.windowHandles[from]) {
            return console.error('Message isnt from the expected window, blocking message...');
        }

        if (isAck) {
            const awaited = this.awaitingAcknowledgement[ackCode];
            awaited && awaited();
            delete this.awaitingAcknowledgement[ackCode];
            return;
        }

        if (isResponse) {
            const awaited = this.awaitingResponse[responseCode];
            if (awaited && awaited.handle === from
                && `RESPONSE_${awaited.request}` === action) {
                delete this.awaitingResponse[responseCode];
                return awaited.deferred(payload);
            }
            return console.warn('a response came in that we weren\'t expecting', event.data);
        }

        const funcs = this.getCallbacks(action);

        if(expectsResponse) {
            if(funcs.length < 1) {
                return this.log('request', 'no callback setup for request:', action);
            }

            if(funcs.length !== 1) {
                return console.error('exactly 1 callback function must be assigned to a responder action');
            }

            const response = funcs[0](action, payload, from);

            if(!response) {
                return console.warn('callback for response didnt yeild a result');
            }

            this.log('request', 'RECIEVED', {
                from,
                action,
                responseCode
            });

            if((response as Promise<object>).then) {
                return (response as Promise<object>).then(resp => {
                    return this.sendResponse(from, action, resp, responseCode);
                });
            }

            this.sendResponse(from, action, response, responseCode);
            return;
        }

        this.log('send', 'RECIEVED', {
            from,
            action,
            ackCode,
            callbacks: funcs.length
        });

        if(ackCode) {
            this.sendAcknowledgement(from, ackCode);
        }

        funcs.forEach(func => {
            func(action, payload, from);
        });
    }

    private internalActions(event:MessageEvent<MBEventDetail>) : void {
        const {
            action,
            payload,
            from
        } = event.data;

        switch (action) {
            case MessagingBus.INTERNAL_ACTIONS.register:
                if (!this.windowHandles[from] || this.windowHandles[from] !== event.source) {
                    this.windowHandles[from] = event.source as Window;
                    if(payload.isChild && !this.directDescendants.includes(from)) {
                        this.directDescendants.push(from);
                    }

                    this.sendToContentWindow(event.source as Window, {
                        action: MessagingBus.INTERNAL_ACTIONS.register,
                        payload: {isChild: false},
                        from: this.localHandle
                    });

                    this.distributeDescendants(from);

                    this.getCallbacks('registered').forEach(fn => {
                        fn('registered', {}, from);
                    });

                    this.log('internal','RECEIVE REGISTRATION', {from});
                }
                break;
            case MessagingBus.INTERNAL_ACTIONS.deregister:
                if (this.windowHandles[from]) {
                    delete this.windowHandles[from];

                    if (this.directDescendants.includes(from)) {
                        this.directDescendants
                            .splice(this.directDescendants.indexOf(from), 1);
                    }

                    this.getCallbacks('deregistered').forEach(fn => {
                        fn('deregistered', {}, from);
                    });

                    this.log('internal', 'RECEIVE DEREGISTRATION', {from});
                }
                break;
            case MessagingBus.INTERNAL_ACTIONS.distribute:
                payload.windows.forEach((win:number) => {
                    if(from !== this.localHandle) {
                        this.getContentWindowByHandle(from)
                            .then(contentWindow => {
                                this.sendToContentWindow(contentWindow.frames[win], {
                                    action: MessagingBus.INTERNAL_ACTIONS.register,
                                    payload: {isChild: false},
                                    from: this.localHandle
                                });
                            });
                    }
                });
                this.log('internal', 'RECEIVE DISTRIBUTE REQUEST', {from});
                break;
        }
    }

    private distributeDescendants(which: string) : void {
        const windows = this.directDescendants
            .filter(handle => {
                return handle !== which;
            })
            .map(handle => {
                const win = this.windowHandles[handle];
                const frameIndex = Array.from(window.frames).reduce((acc, frame, index) => {
                    if(frame === win) {
                        return index;
                    }
                    return acc;
                }, -1);

                return [handle, frameIndex];
            });


        Object.entries(this.getInternalActiveHandles())
            .forEach(([frameHandle, contentWindow]) => {
                const filteredWindows = windows
                    .filter(([handle, frameIndex]) => frameHandle !== handle && frameIndex as number > -1)
                    .map(([,index]) => index);

                this.sendToContentWindow(contentWindow, {
                    action: MessagingBus.INTERNAL_ACTIONS.distribute,
                    payload: {
                        isDescendent: false,
                        windows: filteredWindows
                    },
                    from: this.localHandle
                });
            })
    }

    private getInternalActiveHandles() : WindowHandles {
        return Object.entries(this.windowHandles)
            .filter(([handle, win]) => win && win.self && handle !== this.localHandle)
            .reduce((acc, [handle, window]) =>
                Object.assign({}, acc, {[handle]: window}), {});
    }

    private sendResponse(handle: string, action: string, payload: object, responseCode: number) : Promise<void> {
        return this.getContentWindowByHandle(handle)
            .then(contentWindow => {
                contentWindow.postMessage({
                    _source: '__MessagingBus__',
                    isResponse: true,
                    responseCode,
                    from: this.localHandle,
                    to: handle,
                    action: `RESPONSE_${action}`,
                    payload
                }, '*');
            });
    }

    private sendAcknowledgement(handle: string, ackCode: number) : Promise<void> {
        return this.getContentWindowByHandle(handle)
            .then(contentWindow => {
                contentWindow.postMessage({
                    _source: '__MessagingBus__',
                    isAck: true,
                    to: handle,
                    ackCode,
                    from: this.localHandle
                }, '*');
            });
    }

    private isInternalMessage(action: string) : boolean {
        return action.startsWith('__INTERNAL');
    }

    /**
     * Send Message to window with specific handle
     *
     * A Message is defined as a one shot command with no expected response
     *
     * @param {string} handle - Registered window handle
     * @param {string} action - Action string to pass with the payload
     * @param {Object} payload - the payload data to send with the message
     * @returns {Promise} you may await this promise as an assurance that the receiving end has acknowledged your message,
     * this only ensures that the message was received and not an assurance of being acted upon
     */
    public sendMessage(handle: string, action: string, payload: object) : Promise<void> {
        return this.getContentWindowByHandle(handle)
            .then(contentWindow => this.sendMessageToWindow(contentWindow, action, payload, handle));
    }

    /**
     * Send Message to a specific contentWindow
     *
     * A Message is defined as a one shot command with no expected response
     *
     * @param contentWindow - any valid content window in context
     * @param action - Action string to pass with the payload
     * @param payload - the payload data to send with the message
     * @param [windowHandle] - the handle of the window to which you are sending the message
     * @returns you may await this promise as an assurance that the receiving end has acknowledged your message,
     * this only ensures that the message was received and not an assurance of being acted upon
     */
    public sendMessageToWindow(contentWindow: Window, action: string, payload: object, windowHandle: string) : Promise<void> {
        const ackCode = this.getResponseCode();

        const ackPromise = new Promise((resolve) => {
            this.awaitingAcknowledgement[ackCode] = resolve;
        }).then(() => this.log(this.isInternalMessage(action) ? 'internal_send' : 'send', 'ACKNOWLEDGED', {
            to: handle,
            action,
            ackCode
        }));

        let handle:string|null = windowHandle;
        if(!handle) {
            try {
                handle = this.getHandleByContentWindow(contentWindow);
            } catch(e) {
                return Promise.reject();
            }
        }

        this.sendToContentWindow(contentWindow, {
            from: this.localHandle,
            ackCode,
            to: handle,
            action,
            payload
        });

        this.log(this.isInternalMessage(action) ? 'internal_send' : 'send', 'MESSAGE', {
            to: handle,
            action,
            payload,
            ackCode
        });

        return ackPromise;
    }

    /**
     * Send a Message to all other registered windows
     *
     * A Message is defined as a one shot command with no expected response
     *
     * @param {string} action - Action string to pass with the payload
     * @param {object} payload - the payload data to send with the message
     * @param {boolean} [directDescendantsOnly=false] - if enabled only sends message to direct descendants of the current window,
     * this will stop messages propagating to deeper frames or ancestors
     * @returns {Promise} you may await this promise as an assurance that the all receiving frames have acknowledged your message,
     * this only ensures that the message was received and not an assurance of being acted upon
     */
    public sendMessageToAll(action: string, payload:object, directDescendantsOnly: boolean = false) : Promise<void[]>  {
        return Promise.all(Object.keys(this.getInternalActiveHandles())
            .filter(handle => !directDescendantsOnly || this.directDescendants.includes(handle))
            .map(handle => {
                return this.sendMessage(handle, action, payload)
            }));
    }

    /**
     * Send a Message to all matching registered windows
     *
     * A Message is defined as a one shot command with no expected response
     *
     * @param {RegExp} pattern - regular expression for filtering window handles
     * @param {string} action - Action string to pass with the payload
     * @param {object} payload - the payload data to send with the message
     * @param {boolean} [directDescendantsOnly=false] - if enabled only sends message to direct descendants of the current window,
     * @returns {Promise} you may await this promise as an assurance that the all receiving frames have acknowledged your message,
     * this only ensures that the message was received and not an assurance of being acted upon
     */
    public sendFilteredMessage(pattern: RegExp, action: string, payload: object, directDescendantsOnly: boolean = false) : Promise<void[]> {
        return Promise.all(Object.keys(this.getInternalActiveHandles())
            .filter(handle => !directDescendantsOnly || this.directDescendants.includes(handle))
            .filter(handle => handle.match(pattern))
            .map(handle => {
                return this.sendMessage(handle, action, payload)
            }));
    }

    private sendToContentWindow(contentWindow: Window, data: any) : void {
        if (contentWindow && typeof contentWindow.postMessage === 'function') {
            contentWindow.postMessage(Object.assign({_source: '__MessagingBus__'}, data), '*');
        }
    }

    private getResponseCode() : number {
        let code = Math.floor(Math.random() * 100000);

        while ((Object.keys(this.awaitingResponse) as unknown as number[]).includes(code) ||
        (Object.keys(this.awaitingAcknowledgement) as unknown as number[]).includes(code)) {
            code = Math.floor(Math.random() * 100000);
        }

        return code;
    };

    private getContentWindowByHandle(handle:string ) : Promise<Window> {
        const contentWindow = this.getInternalActiveHandles()[handle];

        if (!contentWindow) {
            // its possible we just need to wait for the handle to be registered
            return new Promise((resolve, reject) => {
                this.waitFor(() => {
                    return !!this.getInternalActiveHandles()[handle];
                }, () => {
                    resolve(this.getInternalActiveHandles()[handle]);
                }, () => {
                    reject(`no window found with handle: ${handle}`);
                }, 500);
            });
        }

        return Promise.resolve(contentWindow);
    }

    private getHandleByContentWindow(contentWindow:Window) : string|null {
        const handles = Object.entries(this.getInternalActiveHandles())
            .find(([, window]) => window === contentWindow);

        if(!handles) {
            return null;
        }

        return handles[0][0];
    }

    private waitFor(waitFunction: Function, onSuccess: Function, onFail: Function, timeout: number) : number {
        const waitHandle = Math.floor(Math.random() * 100000);
        this.waitHandles[waitHandle] = new Date().getTime();

        const interval = setInterval(() => {
            if(!this.waitHandles[waitHandle]) {
                clearInterval(interval);
            }

            if(waitFunction()) {
                delete this.waitHandles[waitHandle];
                clearInterval(interval);
                return onSuccess();
            }
            if(timeout < new Date().getTime() - this.waitHandles[waitHandle]) {
                delete this.waitHandles[waitHandle];
                clearInterval(interval);
                return onFail();
            }
        });

        return waitHandle;
    }

    private cancelWait(handle:number) : void {
        if(this.waitHandles[handle]) {
            delete this.waitHandles[handle];
        }
    }

    /**
     * Send Request to window with specific handle
     *
     * A Request is defined as a command expecting and awaiting a response, if no response is returned within the given timeout the promise will reject
     *
     * @param handle - Registered window handle
     * @param action - Action string to pass with the payload
     * @param payload - the payload data to send with the request
     * @param timeout - maximum time in milliseconds to await a response
     * @returns The response from the specific window referenced by the Handle provided
     */
    public sendRequest(handle: string, action: string, payload: object, timeout: number = 1000) : Promise<RequestResponder>{
        return this.getContentWindowByHandle(handle)
            .then(contentWindow => this.sendRequestToWindow(contentWindow, action, payload, handle, timeout));
    }

    /**
     * Send Request to specific contentWindow
     *
     * A Request is defined as a command expecting and awaiting a response, if no response is returned within the given timeout the promise will reject
     *
     * @param contentWindow - any valid content window in context
     * @param action - Action string to pass with the payload
     * @param payload - the payload data to send with the request
     * @param windowHandle - the handle of the window to which you are sending the message
     * @param timeout - maximum time in milliseconds to await a response
     * @returns The response from the specific window referenced by the Handle provided
     */
    public sendRequestToWindow(contentWindow: Window, action: string, payload: object, windowHandle: string, timeout: number = 1000) : Promise<RequestResponder> {
        const responseCode = this.getResponseCode();

        let handle: string|null = windowHandle;
        if(!handle) {
            try {
                handle = this.getHandleByContentWindow(contentWindow);
            } catch(e) {
                return Promise.reject();
            }
        }

        if(!handle) {
            return Promise.reject("cant find handle for specified window");
        }

        const responsePromise = new Promise((resolve, reject) => {
            this.awaitingResponse[responseCode] = {
                handle: handle as string,
                request: action,
                deferred: resolve
            };

            setTimeout(() => {
                reject('request timed out');
            }, timeout);
        }).then(d => {
            this.log('request', 'RESPONSE', {
                action,
                to: handle,
                responseCode
            });

            return d;
        });

        contentWindow.postMessage({
            _source: '__MessagingBus__',
            expectsResponse: true,
            responseCode,
            from: this.localHandle,
            to: handle,
            action,
            payload
        }, '*');

        this.log('request', 'MESSAGE', {
            to: handle,
            action,
            payload,
            responseCode
        });

        return responsePromise.then((response:any) => ({response, handle}));
    }

    /** Send a Message to all other registered windows
     *
     * A Request is defined as a command expecting and awaiting a response, if no response is returned within the given timeout the promise will reject
     *
     * @param action - Action string to pass with the payload
     * @param payload - the payload data to send with the request
     * @param directDescendantsOnly - if enabled only sends message to direct descendants of the current window,
     * @param allowPartialResponse - if enabled wont reject on a missing response within the timeout period unless all requests fail
     * @param timeout - maximum time in milliseconds to await a response
     * @returns A List of responses from all registered windows
     */
    public sendRequestToAll(action: string, payload: object, directDescendantsOnly:boolean = false, allowPartialResponse:boolean = false, timeout:number = 1000) : Promise<RequestResponder[]>{
        return (new Promise(resolve => {
            if(Object.keys(this.getInternalActiveHandles()).length < 1) {
                return setTimeout(() => {
                    resolve(this.getInternalActiveHandles());
                }, 500);
            }
            return resolve(this.getInternalActiveHandles());
        }) as Promise<WindowHandles>)
            .then(handles => this.sendToMultiple(Object.keys(handles)
                    .filter(handle => !directDescendantsOnly || this.directDescendants.includes(handle)),
                action, payload, allowPartialResponse, timeout));
    }

    /** Send a Message to all matching registered windows
     *
     * A Request is defined as a command expecting and awaiting a response, if no response is returned within the given timeout the promise will reject
     *
     * @param pattern - regular expression for filtering window handles
     * @param action - Action string to pass with the payload
     * @param payload - the payload data to send with the request
     * @param directDescendantsOnly - if enabled only sends message to direct descendants of the current window,
     * @param allowPartialResponse - if enabled wont reject on a missing response within the timeout period unless all requests fail
     * @param timeout - maximum time in milliseconds to await a response
     * @returns A List of responses from all registered windows
     */
    public sendFilteredRequest(pattern: RegExp, action: string, payload: object, directDescendantsOnly:boolean = false, allowPartialResponse:boolean = false, timeout: number = 1000) : Promise<RequestResponder[]> {
        return (new Promise(resolve => {
            if(Object.keys(this.getInternalActiveHandles()).length < 1) {
                return setTimeout(() => {
                    resolve(this.getInternalActiveHandles());
                }, 500);
            }
            return resolve(this.getInternalActiveHandles());
        }) as Promise<WindowHandles>)
            .then(handles => {
                const filtered = Object.keys(handles)
                    .filter(handle => !directDescendantsOnly || this.directDescendants.includes(handle))
                    .filter(handle => handle.match(pattern));

                return this.sendToMultiple(filtered, action, payload, allowPartialResponse, timeout);
            })
    }

    private sendToMultiple(handles: string[], action: string, payload: object, allowPartialResponse:boolean = false, timeout:number = 1000) : Promise<RequestResponder[]> {
        return Promise.all(
            handles.map(handle => {
                const requestPromise = this.sendRequest(handle, action, payload, timeout);
                if(allowPartialResponse) {
                    return requestPromise
                        .catch(() => Promise.resolve({handle, error: 'timed out', timeout: true, response: null}));
                }
                return requestPromise;
            })
        ).then(results => {
            const resultsCount = results.filter(({response}) => !!response).length;
            if(resultsCount < 1) {
                throw new Error('None of the handlers responded within the timeout period');
            }
            return results;
        });
    }

    /**
     * Add a callback function to run when an action is dispatched
     * @param action - Action string provided by the caller
     * @param callback - Function called when message/request received
     */
    public addCallback(action: string, callback: Callback) : void {
        this.callbacks.push({
            action,
            callback
        });
    }

    /**
     * Remove a callback function so that it will no longer be run upon an action being dispatched
     * @param action - Action string provided by the caller
     * @param callback - Function called when message/request received
     */
    public removeCallback(action: string, callback: Callback) : void {
        const remove:ActionCallback|undefined = this.callbacks
            .find(cb => {
                return action === cb.action && callback === cb.callback;
            });

        if (remove) {
            this.callbacks.splice(this.callbacks.indexOf(remove), 1);
        }
    }

    private getCallbacks(requestAction: string) : Callback[] {
        return this.callbacks
            .filter(({action}) => action === requestAction)
            .map(({callback}) => callback);
    }

    /**
     * deregister handle from all listeners
     */
    public destroy() : void {
        this.sendMessageToAll(MessagingBus.INTERNAL_ACTIONS.deregister, {destroyed: true});
        window.removeEventListener('message', this.listener);
        window.removeEventListener('beforeunload', this.destroy);
    }

    /**
     * returns all currently registered handles for valid windows
     * @returns {string[]}
     */
    getActiveHandles() : String[] {
        return Object.keys(this.getActiveHandles());
    }

    /**
     * returns the handle string for the current frames parent
     * @return {string} handle of the parent frame
     * @throws Error if the parent window is not a registered instance
     */
    getParentHandle() : string {
        const [parentHandle] = Object.entries(this.getInternalActiveHandles()).find(([_, value]) => {
            return value === window.parent;
        }) || [];

        if(!parentHandle) {
            throw new Error('Parent Window not registered');
        }

        return parentHandle;
    }

    log(level: string, msg: string, data: any) : void {
        const debug = localStorage.getItem('messagingbus__debug');
        const logLevel = localStorage.getItem('messagingbus__debugLevel') || ['send', 'request'];
        let logColor = localStorage.getItem(`messagingbus__debugColor.${this.localHandle}`);

        if(!debug || !logLevel.includes(level)) {
            return;
        }

        if(!logColor) {
            logColor = `#${((1<<24)*Math.random()|0).toString(16)}`;
            localStorage.setItem(`messagingbus__debugColor.${this.localHandle}`, logColor);
        }

        if(debug === '*' || debug === this.localHandle ||
            (debug.startsWith('*') && this.localHandle.endsWith(debug.substr(1))) ||
            (debug.endsWith('*') && this.localHandle.startsWith(debug.substr(0, debug.length -1)))) {

            const output = typeof data === 'object' ? Object.entries(data).reduce((acc, [key, value]) => {
                return `${acc}\n${key}: ${['string', 'number'].includes(typeof value) ? value : JSON.stringify(value)}`
            }, '') : data;
            console.log(`%cMB ${this.localHandle} | ${level.toUpperCase()}:`, `color: ${logColor}`, msg, output);
        }
    }
}

export default MessagingBus;
