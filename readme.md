# Messaging Bus

A cross frame/window messaging system

to use you may import/require the module directly or for direct use in
browser use the dist module

## How to Use

Add via a script tag or require in your code, then instantiate the class
like so:

```js
const messaging = new MessagingBus('some-unique-name');
```

you will then want to add handlers for any messages/request your app
expects to handle like so:

```js
//for a message
messaging.addCallback('INTERESTING_MESSAGE', (action, payload) => {
    alert('i got a message!', payload.message);
});

//for a request
messaging.addCallback('SOME_REQUEST', (action, payload) => {
    if(payload.something) {
        return 'yes';
    }
    return 'no';
})

//you can also return a promise to run async work and return the result
messaging.addCallback('DO_SOMETHING_ASYNC', (action, payload) => {
    return new Promsie(resolve => {
        setTimeout(() => {
            resolve({
                data: 'yey'
            });
        }, 100);
    })
});
```

### Messages
to dispatch a message to a frame you have three options:

1. [sendMessage](classdocs.md#MessagingBus+sendMessage) | send a message
   to a specific window/frame knowing the exact handle (registered at
   class instantiation)
2. [sendMessageToWindow](classdocs.md#MessagingBus+sendMessageToWindow) | send a message
   to a specific window/frame knowing the contentWindow
3. [sendMessageToAll](classdocs.md#MessagingBus+sendMessageToAll) | send
   a message to all other windows (or just direct descendants)
4. [sendFilteredMessage](classdocs.md#MessagingBus+sendFilteredMessage)
   | send a message to any registered instances that match a given regex
   pattern
   
to send a message to a specific instance by handle do the following:

```js
messaging.sendMessage('specific-unique-id', 'INTERESTING_MESSAGE', {
    messgae: 'something interesting, no doubt'
});
```

#### Note:
the message sending methods return a promise, you may send and not
listen to the resolve of this promise if you dont require message send
acknowledgement, the promise will simply resolve empty once the message
has been acknowledged by the receiving end, to ensure delivery listen
for the promise resolution.

### Requests
to dispatch a request to a frame and await its return you also have
three almost identical options:

1. [sendRequest](classdocs.md#MessagingBus+sendRequest) | send a request
   to a specific window/frame knowing the exact handle (registered at
   class instantiation) and await a response
2. [sendRequestToWindow](classdocs.md#MessagingBus+sendRequestToWindow) | send a request
   to a specific window/frame knowing the contentWindow
3. [sendRequestToAll](classdocs.md#MessagingBus+sendRequestToAll) | send
   a request to all other windows (or just direct descendants) and await
   a response from all
4. [sendFilteredRequest](classdocs.md#MessagingBus+sendFilteredRequest)
   | send a request to any registered instances that match a given regex
   pattern and await a response from all
   
all three of these methods returns a Promise with the response data and
handle from the window/frame(s) that were requested.

to send a request to a specific instance by handle and parse the result 
do the following:

```js
messaging.sendRequest('specific-unique-id', 'SOME_REQUEST', {
    data: 'something interesting, no doubt'
})
    .then(res => {
        alert(res.response.data);
    });
```

#### Request Specific Parameters

##### timeout requests have a timeout, by default this is set to 1 second
(1000ms) you may set this to a time limit you believe is more suitable
for your request, by default if a request isn't returned within the
timeout period the Promise is rejected. See
[allowPartialResponse](#allowPartialResponse) property for allowing some
responses to not return in a request to multiple frames/windows.

#### Multi Request Parameters

##### directDescendantsOnly
 set this to true if you only want to dispatch requests to direct
 children and not grandchildren or deeper, this can be useful if you
 know you have deeper frames with instantiated handlers, but dont wish
 to accidentally trigger

##### allowPartialResponse
 set this to true to allow some frames to not respond within the given
 timeout period, the default behaviour is to reject on any non returning
 response, but with this on your request will only reject if no
 responses are returned.

# API Docs

<!-- TSDOC_START -->

## :factory: MessagingBus

### Methods

- [sendMessage](#gear-sendmessage)
- [sendMessageToWindow](#gear-sendmessagetowindow)
- [sendMessageToAll](#gear-sendmessagetoall)
- [sendFilteredMessage](#gear-sendfilteredmessage)
- [sendRequest](#gear-sendrequest)
- [sendRequestToWindow](#gear-sendrequesttowindow)
- [sendRequestToAll](#gear-sendrequesttoall)
- [sendFilteredRequest](#gear-sendfilteredrequest)
- [addCallback](#gear-addcallback)
- [removeCallback](#gear-removecallback)
- [destroy](#gear-destroy)
- [getActiveHandles](#gear-getactivehandles)
- [getParentHandle](#gear-getparenthandle)
- [log](#gear-log)

#### :gear: sendMessage

Send Message to window with specific handle

A Message is defined as a one shot command with no expected response

| Method | Type |
| ---------- | ---------- |
| `sendMessage` | `(handle: string, action: string, payload: object) => Promise<void>` |

Parameters:

* `handle`: - Registered window handle
* `action`: - Action string to pass with the payload
* `payload`: - the payload data to send with the message


#### :gear: sendMessageToWindow

Send Message to a specific contentWindow

A Message is defined as a one shot command with no expected response

| Method | Type |
| ---------- | ---------- |
| `sendMessageToWindow` | `(contentWindow: Window, action: string, payload: object, windowHandle: string) => Promise<void>` |

Parameters:

* `contentWindow`: - any valid content window in context
* `action`: - Action string to pass with the payload
* `payload`: - the payload data to send with the message
* `windowHandle`: - the handle of the window to which you are sending the message


#### :gear: sendMessageToAll

Send a Message to all other registered windows

A Message is defined as a one shot command with no expected response

| Method | Type |
| ---------- | ---------- |
| `sendMessageToAll` | `(action: string, payload: object, directDescendantsOnly?: boolean) => Promise<void[]>` |

Parameters:

* `action`: - Action string to pass with the payload
* `payload`: - the payload data to send with the message
* `directDescendantsOnly`: - if enabled only sends message to direct descendants of the current window,
this will stop messages propagating to deeper frames or ancestors


#### :gear: sendFilteredMessage

Send a Message to all matching registered windows

A Message is defined as a one shot command with no expected response

| Method | Type |
| ---------- | ---------- |
| `sendFilteredMessage` | `(pattern: RegExp, action: string, payload: object, directDescendantsOnly?: boolean) => Promise<void[]>` |

Parameters:

* `pattern`: - regular expression for filtering window handles
* `action`: - Action string to pass with the payload
* `payload`: - the payload data to send with the message
* `directDescendantsOnly`: - if enabled only sends message to direct descendants of the current window,


#### :gear: sendRequest

Send Request to window with specific handle

A Request is defined as a command expecting and awaiting a response, if no response is returned within the given timeout the promise will reject

| Method | Type |
| ---------- | ---------- |
| `sendRequest` | `(handle: string, action: string, payload: object, timeout?: number) => Promise<RequestResponder>` |

Parameters:

* `handle`: - Registered window handle
* `action`: - Action string to pass with the payload
* `payload`: - the payload data to send with the request
* `timeout`: - maximum time in milliseconds to await a response


#### :gear: sendRequestToWindow

Send Request to specific contentWindow

A Request is defined as a command expecting and awaiting a response, if no response is returned within the given timeout the promise will reject

| Method | Type |
| ---------- | ---------- |
| `sendRequestToWindow` | `(contentWindow: Window, action: string, payload: object, windowHandle: string, timeout?: number) => Promise<RequestResponder>` |

Parameters:

* `contentWindow`: - any valid content window in context
* `action`: - Action string to pass with the payload
* `payload`: - the payload data to send with the request
* `windowHandle`: - the handle of the window to which you are sending the message
* `timeout`: - maximum time in milliseconds to await a response


#### :gear: sendRequestToAll

Send a Message to all other registered windows

A Request is defined as a command expecting and awaiting a response, if no response is returned within the given timeout the promise will reject

| Method | Type |
| ---------- | ---------- |
| `sendRequestToAll` | `(action: string, payload: object, directDescendantsOnly?: boolean, allowPartialResponse?: boolean, timeout?: number) => Promise<RequestResponder[]>` |

Parameters:

* `action`: - Action string to pass with the payload
* `payload`: - the payload data to send with the request
* `directDescendantsOnly`: - if enabled only sends message to direct descendants of the current window,
* `allowPartialResponse`: - if enabled wont reject on a missing response within the timeout period unless all requests fail
* `timeout`: - maximum time in milliseconds to await a response


#### :gear: sendFilteredRequest

Send a Message to all matching registered windows

A Request is defined as a command expecting and awaiting a response, if no response is returned within the given timeout the promise will reject

| Method | Type |
| ---------- | ---------- |
| `sendFilteredRequest` | `(pattern: RegExp, action: string, payload: object, directDescendantsOnly?: boolean, allowPartialResponse?: boolean, timeout?: number) => Promise<RequestResponder[]>` |

Parameters:

* `pattern`: - regular expression for filtering window handles
* `action`: - Action string to pass with the payload
* `payload`: - the payload data to send with the request
* `directDescendantsOnly`: - if enabled only sends message to direct descendants of the current window,
* `allowPartialResponse`: - if enabled wont reject on a missing response within the timeout period unless all requests fail
* `timeout`: - maximum time in milliseconds to await a response


#### :gear: addCallback

Add a callback function to run when an action is dispatched

| Method | Type |
| ---------- | ---------- |
| `addCallback` | `(action: string, callback: Callback) => void` |

Parameters:

* `action`: - Action string provided by the caller
* `callback`: - Function called when message/request received


#### :gear: removeCallback

Remove a callback function so that it will no longer be run upon an action being dispatched

| Method | Type |
| ---------- | ---------- |
| `removeCallback` | `(action: string, callback: Callback) => void` |

Parameters:

* `action`: - Action string provided by the caller
* `callback`: - Function called when message/request received


#### :gear: destroy

deregister handle from all listeners

| Method | Type |
| ---------- | ---------- |
| `destroy` | `() => void` |

#### :gear: getActiveHandles

returns all currently registered handles for valid windows

| Method | Type |
| ---------- | ---------- |
| `getActiveHandles` | `() => String[]` |

#### :gear: getParentHandle

returns the handle string for the current frames parent

| Method | Type |
| ---------- | ---------- |
| `getParentHandle` | `() => string` |

#### :gear: log

| Method | Type |
| ---------- | ---------- |
| `log` | `(level: string, msg: string, data: any) => void` |


<!-- TSDOC_END -->

# Debugging
to enable debugging set the localStorage value: `messagingbus__debug` to a MessagingBus instance handle or `*`
for instance to log all messagingBus instances run the following in console:
```js
localStorage.messagingbus__debug = '*';
```

you may also set a wild card beginning or end to your debug specifier for instance: `*instance` which would allow for windows with a handle ending in `instance` to show debugging.

## Debug Levels
by default debug is enabled for sending messages and requests, you may also enable for internal messages and/or internal send events by setting the localstorage item: `messagingbus__debugLevel`

### Allowed Values:
* `send`
* `request`
* `internal`
* `internal_send`

to set which log levels you wish to see use the following code:
```js
localStorage.messagingbus__debugLevel = ['internal', 'request']; //this will enable internal messaging debugging and request debugging but disable send and internal send debugging
```