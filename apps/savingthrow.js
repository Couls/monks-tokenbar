import { MonksTokenBar, log, i18n, setting } from "../monks-tokenbar.js";

export class SavingThrowApp extends Application {
    constructor(entries, options = {}) {
        super(options);

        this.opts = options;

        if (entries != undefined && !$.isArray(entries))
            entries = [entries];
        if (entries == undefined || entries.length == 0)
            this.entries = MonksTokenBar.getTokenEntries(canvas.tokens.controlled.filter(t => t.actor != undefined));
        else
            this.entries = entries;

        if (this.entries.length == 0) {   //if none have been selected then default to the party
            this.entries = MonksTokenBar.getTokenEntries(canvas.tokens.placeables.filter(t => {
                let include = t.document.getFlag('monks-tokenbar', 'include');
                include = (include === true ? 'include' : (include === false ? 'exclude' : include || 'default'));
                return (t.actor != undefined && ((t.actor?.hasPlayerOwner && t.document.disposition == 1 && include != 'exclude') || include === 'include'));
            }));
        }
        this.rollmode = (options?.rollmode || options?.rollMode || game.user.getFlag("monks-tokenbar", "lastmodeST") || 'roll');
        if (!["roll", "gmroll", "blindroll", "selfroll"].includes(this.rollmode))
            this.rollmode = "roll";
        this.baseoptions = this.requestoptions = (options.requestoptions || MonksTokenBar.system.requestoptions);

        this.baseoptions = this.baseoptions.filter(g => g.groups);
        for (let attr of this.baseoptions) {
            attr.groups = duplicate(attr.groups);
            for (let [k, v] of Object.entries(attr.groups)) {
                attr.groups[k] = v?.label || v;
            }
        }

        this.request = MonksTokenBar.findBestRequest(options.request, this.baseoptions);
        this.flavor = options.flavor;

        this.dc = options.dc;
        this.showdc = options.showdc;
        this.callback = options.callback;
    }

    static get defaultOptions() {
        return mergeObject(super.defaultOptions, {
            id: "requestsavingthrow",
            title: i18n("MonksTokenBar.RequestRoll"),
            template: "./modules/monks-tokenbar/templates/savingthrow.html",
            width: 800,
            popOut: true
        });
    }

    getData(options) {
        this.requestoptions = this.baseoptions;

        if (this.entries.length > 0) {
            let dynamic = MonksTokenBar.system.dynamicRequest(this.entries);
            if (dynamic)
                this.requestoptions = this.requestoptions.concat(dynamic);
        }

        return {
            entries: this.entries,
            rollmode: this.rollmode,
            flavor: this.flavor,
            dc: this.dc,
            showdc: this.showdc,
            dclabel: MonksTokenBar.system.dcLabel,
            options: this.requestoptions
        };
    }

    async close(options = {}) {
        let restart = this['active-tiles'];
        if (!this.requestingResults && restart) {
            //clear the saved state if the GM closes the request
            let tile = await fromUuid(restart.tile);
            tile.resumeActions(restart.id, { continue: false });
        }
        return super.close(options);
    }

    addToken(tokens) {
        if (!$.isArray(tokens))
            tokens = [tokens];

        let failed = [];
        tokens = tokens.filter(t => {
            //don't add this token a second time
            if (this.entries.includes(e => e.token.id == t.id))
                return false;
            if (t.actor == undefined) {
                failed.push(t.name);
                return false;
            }
            return true;
        });

        if (failed.length > 0)
            ui.notifications.warn(i18n("MonksTokenBar.TokenNoActorAttrs"));

        if (tokens.length > 0)
            this.entries = this.entries.concat(MonksTokenBar.getTokenEntries(tokens));

        this.render(true);
    }
    changeTokens(e) {
        let type = e.target.dataset.type;
        switch (type) {
            case 'player':
                this.entries = MonksTokenBar.getTokenEntries(canvas.tokens.placeables.filter(t => {
                    let include = t.document.getFlag('monks-tokenbar', 'include');
                    include = (include === true ? 'include' : (include === false ? 'exclude' : include || 'default'));
                    return (t.actor != undefined && ((t.actor?.hasPlayerOwner && t.document.disposition == 1 && include != 'exclude') || include === 'include'));
                }));
                this.render(true);
                break;
            case 'last':
                if (SavingThrow.lastTokens) {
                    this.entries = duplicate(SavingThrow.lastTokens);
                    this.request = duplicate(SavingThrow.lastRequest);
                    this.render(true);
                }
                break;
            case 'actor': //toggle the select actor button
                let tokens = canvas.tokens.controlled.filter(t => t.actor != undefined);
                if (tokens.length == 0)
                    ui.notifications.error('No tokens are currently selected');
                else
                    this.addToken(tokens);
                break;
            case 'clear':
                this.entries = [];
                this.render(true);
                break;
        }
    }

    removeToken(id) {
        let idx = this.entries.findIndex(t => t.id === id);
        if (idx > -1) {
            this.entries.splice(idx, 1);
        }
        $(`li[data-item-id="${id}"]`, this.element).remove();
        //this.render(true);
    }

    async requestRoll(roll) {
        let msg = null;
        if (this.entries.length > 0) {
            SavingThrow.lastTokens = this.entries;
            let msgEntries = this.entries.map(t => {
                return {
                    id: t.token.id,
                    uuid: t.token.document.uuid,
                    actorid: t.token.actor.id,
                    icon: (t.token.document.texture.src.endsWith('webm') ? t.token.actor.img : t.token.document.texture.src),
                    name: t.token.name,
                    keys: t.keys,
                };
            });
            SavingThrow.lastRequest = this.request;

            if (this.request == undefined || !this.request.length) {
                log('Invalid request');
                ui.notifications.error("Please select a request to roll");
                return;
            }

            let rollmode = this.rollmode;
            game.user.setFlag("monks-tokenbar", "lastmodeST", rollmode);
            let modename = (rollmode == 'roll' ? i18n("MonksTokenBar.PublicRoll") : (rollmode == 'gmroll' ? i18n("MonksTokenBar.PrivateGMRoll") : (rollmode == 'blindroll' ? i18n("MonksTokenBar.BlindGMRoll") : i18n("MonksTokenBar.SelfRoll"))));

            this.request = this.request instanceof Array ? this.request : [this.request];
            let requests = this.request.map(r => {
                r.name = MonksTokenBar.getRequestName(this.requestoptions, r);
                return r;
            });
            let flavor = this.flavor;
            let name = this.opts?.name || MonksTokenBar.getRequestName(this.requestoptions, requests[0]);

            if (requests[0].type == 'misc' && requests[0].key == 'init') {
                if (!game.combats.active) {
                    await Dialog.confirm({
                        title: "No Combat",
                        content: "You're asking for an initiative roll but there's no combat.  <br />Would you like to start a combat with these tokens?<br />",
                        yes: async () => {
                            const cls = getDocumentClass("Combat")
                            await cls.create({ scene: canvas.scene.id, active: true });
                        }
                    });
                }

                let combat = game.combats.active;
                if (combat) {
                    let combatants = []
                    for (let token of this.entries) {
                        if (!combat.combatants.find(c => c.token?.id == token.token.id))
                            combatants.push({ tokenId: token.token.id, actorId: token.token.actor?.id });
                    }
                    if (combatants.length)
                        await Combatant.createDocuments(combatants, { parent: combat });
                }
            }
            
            let requestdata = {
                dc: this.dc || (this.request[0].key == 'death' && ['dnd5e', 'sw5e'].includes(game.system.id) ? '10' : ''),
                showdc: this.showdc,
                name: name,
                requests: requests,
                rollmode: rollmode,
                modename: modename,
                tokens: msgEntries,
                canGrab: MonksTokenBar.system.canGrab,//['dnd5e', 'sw5e'].includes(game.system.id),
                showAdvantage: MonksTokenBar.system.showAdvantage,
                options: this.opts,
                what: 'savingthrow',
            };
            const html = await renderTemplate("./modules/monks-tokenbar/templates/svgthrowchatmsg.html", requestdata);

            delete requestdata.tokens;
            delete requestdata.canGrab;
            for (let i = 0; i < msgEntries.length; i++)
                requestdata["token" + msgEntries[i].id] = msgEntries[i];

            let whisper = [game.user.id];
            for (let i = 0; i < this.entries.length; i++) {
                let token = this.entries[i].token;
                if (token.actor != undefined) {
                    for (let key of Object.keys(token.actor.ownership)) {
                        if (key != 'default' && token.actor.ownership[key] >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER) {
                            if (whisper.find(t => t == key) == undefined)
                                whisper.push(key);
                        }
                    }
                }
            }

            log('create chat request');
            let chatData = {
                user: game.user.id,
                content: html,
                flavor: flavor,
                flags: { core: { canPopout: true } }
            };
            if (requestdata.rollmode == 'selfroll')
                chatData.whisper = [game.user.id];
            else if (requestdata.rollmode == 'blindroll')
                chatData.whisper = whisper;

            //chatData.flags["monks-tokenbar"] = {"testmsg":"testing"};
            setProperty(chatData, "flags.monks-tokenbar", requestdata);
            msg = await ChatMessage.create(chatData, {});
            msg.mtb_callback = this.opts.callback;
            if (setting('request-roll-sound-file') != '' && rollmode != 'selfroll' && roll !== false)
                MonksTokenBar.playSound(setting('request-roll-sound-file'), whisper);
            this.requestingResults = true;
            this.close();

            if (this['active-tiles'])
                msg.setFlag('monks-tokenbar', 'active-tiles', this['active-tiles']);

            if (roll === true)
                SavingThrow.onRollAll('all', msg, this.opts);
            else {
                let ids = this.entries.filter(e => e.fastForward).map(e => e.id);
                if (ids.length > 0)
                    SavingThrow.onRollAbility(ids, msg, true, this.opts);
            }
        } else
            ui.notifications.warn(i18n("MonksTokenBar.RequestNoneTokenSelected"));

        return msg;
    }

    activateListeners(html) {
        super.activateListeners(html);
        var that = this;

        $('.items-header .item-controls', html).click($.proxy(this.changeTokens, this));

        $('.item-list .item', html).each(function (elem) {
            $('.item-delete', this).click($.proxy(that.removeToken, that, this.dataset.itemId));
        });

        $('.dialog-button.request', html).click($.proxy(this.requestRoll, this));
        $('.dialog-button.request-roll', html).click($.proxy(this.requestRoll, this, true));
        $('.dialog-button.save-macro', html).click(this.saveToMacro.bind(this));

        $('#monks-tokenbar-savingdc', html).blur($.proxy(function (e) {
            this.dc = $(e.currentTarget).val();
        }, this));
        $('#monks-tokenbar-showdc', html).click($.proxy(function (e) {
            this.showdc = $(e.currentTarget).prop('checked');
        }, this));
        $('#monks-tokenbar-flavor', html).blur($.proxy(function (e) {
            this.flavor = $(e.currentTarget).val();
        }, this));
        $('.request-roll .request-option', html).click($.proxy(function (e) {
            let target = $(e.currentTarget);
            let type = e.currentTarget.dataset.type;
            let key = e.currentTarget.dataset.key;
            if (e.ctrlKey) {
                if (this.request instanceof Array) {
                    if (this.request.length > 1 && this.request.some(r => r.type == type && r.key == key)) {
                        this.request.findSplice(r => r.type == type && r.key == key);
                        target.removeClass('selected');
                    } else if (!this.request.some(r => r.type == type && r.key == key)){
                        this.request.push({ type, key });
                        target.addClass('selected');
                    }
                } else {
                    if (this.request.type != type && this.request.key != key) {
                        this.request = [this.request, { type, key }];
                        target.addClass('selected');
                    }
                }
            } else {
                this.request = [{ type, key }];
                $('.request-roll .request-option.selected', html).removeClass('selected');
                target.addClass('selected');
            }
        }, this));
        $('#savingthrow-rollmode', html).change($.proxy(function (e) {
            this.rollmode = $(e.currentTarget).val();
        }, this));
    };

    async saveToMacro() {
        let tokens = this.entries.map(t => { return { token: t.token.name } });

        let requests = this.request instanceof Array ? this.request : [this.request];
        let name = MonksTokenBar.getRequestName(this.requestoptions, requests[0]);

        let folder = game.folders.find(f => { return f.type == "Macro" && f.name == "Monk's Tokenbar" });
        if (!folder) {
            folder = await Folder.create(new Folder({ "type": "Macro", "folder": null, "name": "Monk's Tokenbar", "color": null, "sorting": "a" }));
        }

        let macroCmd = `game.MonksTokenBar.requestRoll(${JSON.stringify(tokens)},{request:${requests ? JSON.stringify(requests) : 'null'}${($.isNumeric(this.dc) ? ', dc:' + this.dc : '')}${(this.showdc ? ', showdc:' + this.showdc : '')}, silent:false, fastForward:false${this.flavor != undefined ? ", flavor:'" + this.flavor + "'" : ''}, rollMode:'${this.rollmode}'})`;
        const macro = await Macro.create({ name: name, type: "script", scope: "global", command: macroCmd, folder: folder.id });
        macro.sheet.render(true);
    }
}

export class SavingThrow {
    static msgcontent = {};
    static lastTokens;

    static async rollDice(dice) {
        let r = new Roll(dice);
        return r.evaluate({ async: true });
    }

    static async returnRoll (id, roll, actor, rollmode, msgId) {
        log("Roll", roll, actor);
        if (roll != undefined) {
            if (roll instanceof Combat) {
                let realroll;

                // try and extract the roll from a saved value
                let message = game.messages.get(msgId);
                if (message) {
                    let rolls = getProperty(message, "flags.monks-tokenbar.rolls");
                    realroll = rolls[id];
                    if (realroll)
                        return { id: id, roll: realroll, finish: null, reveal: true };
                }

                // if it wasn't extracted, then just pull the value from the combat and fake the roll
                let combatant = roll.combatants.find(c => { return c?.actor?.id == actor.id });
                if (combatant != undefined) {
                    let initTotal = combatant.actor.system.attributes.init.total;
                    let jsonRoll = {
                        "class": "Roll",
                        "dice": [],
                        "formula": `1d20 + ${initTotal}`,
                        "terms": [
                            {
                                "class": "Die",
                                "options": {
                                    "critical": 20,
                                    "fumble": 1
                                },
                                "evaluated": true,
                                "number": 1,
                                "faces": 20,
                                "modifiers": [],
                                "results": [
                                    {
                                        "result": (combatant.initiative - initTotal),
                                        "active": true
                                    }
                                ]
                            },
                            {
                                "class": "OperatorTerm",
                                "options": {},
                                "evaluated": true,
                                "operator": "+"
                            },
                            {
                                "class": "NumericTerm",
                                "options": {},
                                "evaluated": true,
                                "number": initTotal
                            }
                        ],
                        "total": combatant.initiative,
                        "evaluated": true
                    };
                    fakeroll = Roll.fromData(jsonRoll);
                    return { id: id, roll: fakeroll, finish: null, reveal: true };
                } else {
                    log('Actor is not part of combat to roll initiative', actor, roll);
                    ui.notifications.warn(i18n("MonksTokenBar.ActorNotCombatant"));
                }
            } else {
                let finishroll;
                if (roll instanceof ChatMessage) {
                    let msg = roll;
                    roll = msg.roll || msg.rolls[0];
                    msg.delete();
                    if (!(roll instanceof Roll))
                        roll = Roll.fromJSON(roll);
                }

                let whisper = (rollmode == 'roll' ? null : ChatMessage.getWhisperRecipients("GM").map(w => { return w.id }));
                if (rollmode == 'gmroll' && !game.user.isGM)
                    whisper.push(game.user.id);
                if (game.dice3d != undefined && roll instanceof Roll && roll.ignoreDice !== true && MonksTokenBar.system.showRoll) {
                    finishroll = game.dice3d.showForRoll(roll, game.user, true, whisper, rollmode !== 'roll' && !game.user.isGM, (rollmode == 'selfroll' ? msgId : null)).then(() => { //
                        return { id: id, reveal: true, userid: game.userId };
                    });
                }
                const sound = MonksTokenBar.getDiceSound();
                if (sound != undefined && (rollmode != 'selfroll' || setting('gm-sound')))
                    MonksTokenBar.playSound(sound, (rollmode == 'roll' || rollmode == 'gmroll' ? 'all' : whisper));

                return { id: id, roll: roll, finish: finishroll };
            }
        }
    }

    static async _rollAbility(data, requests, rollmode, ffwd, e, message) {
        //let actor = game.actors.get(data.actorid);
        let tokenOrActor = await fromUuid(data.uuid);
        let actor = tokenOrActor?.actor ? tokenOrActor.actor : tokenOrActor;
        let fastForward = ffwd || (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey);

        if (actor != undefined) {
            let request = requests instanceof Array ? (requests.length == 1 ? requests[0] : null) : requests;
            if (!request && requests.length > 1) {
                // Select which of the requests to use
                if (ffwd) {
                    request = requests[0];
                } else {
                    let buttons = requests.map(r => {
                        return {
                            label: r.name,
                            callback: () => r
                        }
                    });
                    request = await Dialog.wait({
                        title: "Please pick a roll",
                        content: "",
                        focus: true,
                        close: () => { return null; },
                        buttons: buttons
                    }, { classes: ["savingthrow-picker"], width: 300 });
                }
            }

            if (!request)
                return;

            if (request.type == 'dice') {
                //roll the dice
                return SavingThrow.rollDice(request.key).then((roll) => {
                    return SavingThrow.returnRoll(data.id, roll, actor, rollmode, message.id).then((result) => { if (result) result.request = request; return result; });
                });
            } else {
                if (MonksTokenBar.system._supportedSystem) {
                    return MonksTokenBar.system.roll({ id: data.id, actor: actor, request: request, rollMode: rollmode, fastForward: fastForward, message: message }, function (roll) {
                        return SavingThrow.returnRoll(data.id, roll, actor, rollmode, message.id).then((result) => { if (result) result.request = request; return result; });
                    }, e);
                }
                else {
                    ui.notifications.warn(i18n("MonksTokenBar.UnknownSystem"));
                }
            }
        }
    }

    static async onRollAbility(ids, message, fastForward = false, evt) {
        if (ids == undefined) return;
        if (!$.isArray(ids))
            ids = [ids];

        let flags = message.flags['monks-tokenbar'];

        let requests = message.getFlag('monks-tokenbar', 'requests');
        let rollmode = message.getFlag('monks-tokenbar', 'rollmode');

        let promises = [];
        for (let id of ids) {
            let msgtoken = flags["token" + id];
            if (msgtoken != undefined && msgtoken.roll == undefined) {
                //let actor = game.actors.get(msgtoken.actorid);
                let tokenOrActor = await fromUuid(msgtoken.uuid);
                let actor = tokenOrActor?.actor ? tokenOrActor.actor : tokenOrActor;
                if (actor != undefined) {
                    //roll the dice, using standard details from actor
                    let keys = msgtoken.keys || {};
                    let e = Object.assign({}, evt);
                    e.ctrlKey = evt?.ctrlKey;
                    e.altKey = evt?.altKey;
                    e.shiftKey = evt?.shiftKey;
                    e.metaKey = evt?.metaKey;

                    for (let [k, v] of Object.entries(keys))
                        e[k] = evt[k] || v;
                    MonksTokenBar.system.parseKeys(e, keys);

                    promises.push(SavingThrow._rollAbility({ id: id, uuid: msgtoken.uuid }, requests, rollmode, fastForward, e, message));
                }
            }
        };

        return Promise.all(promises).then(async (response) => {
            log('roll all finished', response);
            if (!game.user.isGM) {
                let responses = response.map(r => { return { id: r.id, roll: r.roll }; });
                MonksTokenBar.emit('rollability',
                    {
                        type: 'savingthrow',
                        msgid: message.id,
                        response: responses
                    }
                );

                let promises = response.filter(r => r.finish != undefined).map(r => { return r.finish; });
                if (promises.length) {
                    Promise.all(promises).then(response => {
                        SavingThrow.finishRolling(response, message);
                    });
                }
            } else {
                const revealDice = game.dice3d ? game.settings.get("dice-so-nice", "immediatelyDisplayChatMessages") : true;
                return await SavingThrow.updateMessage(response, message, revealDice);
            }
        });
    }

    static collectResults() {
        
    }

    static async updateMessage(updates, message, reveal = true) {
        if (updates == undefined) return;

        let dc = message.getFlag('monks-tokenbar', 'dc');
        if ($.isNumeric(dc))
            dc = parseInt(dc);

        let content = $(message.content);

        let flags = {};

        let promises = [];

        for (let update of updates) {
            if (update != undefined) {
                let msgtoken = duplicate(message.getFlag('monks-tokenbar', 'token' + update.id));
                log('updating actor', msgtoken, update.roll);

                if (update.roll) {
                    let tooltip = '';
                    if (update.roll instanceof Roll) {
                        msgtoken.roll = update.roll.toJSON();
                        if (msgtoken.roll.terms.length)
                            msgtoken.roll.terms = duplicate(msgtoken.roll.terms);
                        for (let i = 0; i < msgtoken.roll.terms.length; i++) {
                            if (msgtoken.roll.terms[i] instanceof RollTerm)
                                msgtoken.roll.terms[i] = msgtoken.roll.terms[i].toJSON();
                        }
                        msgtoken.total = update.roll.total;
                        msgtoken.reveal = update.reveal || reveal;
                        msgtoken.request = update.request;
                        tooltip = await update.roll.getTooltip();

                        Hooks.callAll('tokenBarUpdateRoll', this, message, update.id, msgtoken.roll);
                    }

                    if ($.isNumeric(dc))
                        msgtoken.passed = MonksTokenBar.system.rollSuccess(msgtoken.roll, dc);

                    $('.item[data-item-id="' + update.id + '"] .dice-roll .dice-tooltip', content).remove();
                    $(tooltip).hide().insertAfter($('.item[data-item-id="' + update.id + '"] .item-row', content));
                    $('.item[data-item-id="' + update.id + '"] .item-row .item-roll', content).remove();
                    $('.item[data-item-id="' + update.id + '"] .item-row .roll-controls .dice-total', content).remove();
                    $('.item[data-item-id="' + update.id + '"] .item-row .roll-controls', content).append(
                        `<div class="dice-total flexrow noselect" style="display:none;">
                        <div class="dice-result noselect ${(msgtoken.reveal ? 'reveal' : '')}"><span class="smoke-screen">...</span><span class="total">${msgtoken.total}</span></div >
                        <a class="item-control result-passed gm-only" data-control="rollPassed">
                            <i class="fas fa-check"></i>
                        </a>
                        <a class="item-control result-failed gm-only" data-control="rollFailed">
                            <i class="fas fa-times"></i>
                        </a>
                        <div class="dice-text player-only"></div>
                    </div >`);
                    flags["token" + update.id] = msgtoken;
                    //await message.setFlag('monks-tokenbar', 'token' + update.id, msgtoken);
                } else if (update.error === true) {
                    //let actor = game.actors.get(msgtoken.actorid);
                    let tokenOrActor = await fromUuid(msgtoken.uuid);
                    let actor = tokenOrActor?.actor ? tokenOrActor.actor : tokenOrActor;

                    ui.notifications.warn(msgtoken.name + ': ' + update.msg);

                    $('.item[data-item-id="' + update.id + '"] .item-row .item-roll', content).remove();
                    $('.item[data-item-id="' + update.id + '"] .item-row .roll-controls .dice-total', content).remove();
                    $('.item[data-item-id="' + update.id + '"] .item-row .roll-controls', content).append(
                        `<div class="dice-total flexrow noselect" style="display:none;"><div class="dice-result">Error!</div ></div >`);
                    msgtoken.reveal = true;
                    msgtoken.error = true;
                    flags["token" + update.id] = msgtoken;
                }

                if (update.finish != undefined)
                    promises.push(update.finish);
            }
        }

        await message.update({ content: content[0].outerHTML, flags: { 'monks-tokenbar': flags } });

        if (promises.length) {
            Promise.all(promises).then(response => {
                log('rolls revealed', response);
                SavingThrow.finishRolling(response, message);
            });
        }

        //if everyone has rolled
        let total = 0;
        let failed = 0;
        let passed = 0;
        let tokenresults = Object.entries(message.flags['monks-tokenbar'])
            .filter(([k, v]) => {
                return k.startsWith('token')
            })
            .map(([k, token]) => {
                let pass = null;
                if (token.roll) {
                    total += token.roll.total;
                    pass = (isNaN(dc) || MonksTokenBar.system.rollSuccess(token.roll, dc));
                    if (pass === true || pass === "success")
                        passed++;
                    else if (pass === false || pass === "failed")
                        failed++;
                }

                let result = {
                    id: token.id,
                    uuid: token.uuid,
                    roll: token.roll,
                    name: token.name,
                    passed: (pass === true || pass === "success"),
                    actor: game.actors.get(token.actorid)
                };
                if (MonksTokenBar.system.useDegrees)
                    result.degree = (pass == "success" || pass == "failed" ? pass : null);
                return result;
            });

        if (passed + failed == tokenresults.length) {
            let grouproll = (total / tokenresults.length);
            let result = { dc: dc, grouproll: grouproll, percent: Math.max(Math.min((grouproll / dc), 1), 0), passed: passed, failed: failed, tokenresults: tokenresults };
            if (message.getFlag('monks-tokenbar', 'active-tiles')) {
                let restart = message.getFlag('monks-tokenbar', 'active-tiles');
                let tile = await fromUuid(restart.tile);

                if (restart.action.data.usetokens == 'fail' || restart.action.data.usetokens == 'succeed') {
                    result.tokens = result.tokenresults.filter(r => r.passed == (restart.action.data.usetokens == 'succeed'));
                    for (let i = 0; i < result.tokens.length; i++) {
                        result.tokens[i] = await fromUuid(result.tokens[i].uuid);
                    }
                }

                result.continue = restart.action.data.continue == 'always' ||
                    (restart.action.data.continue == 'passed' && result.passed > 0) ||
                    (restart.action.data.continue == 'failed' && result.failed > 0) ||
                    (restart.action.data.continue == 'allpass' && result.passed == result.tokenresults.length) ||
                    (restart.action.data.continue == 'allfail' && result.failed == result.tokenresults.length);

                tile.resumeActions(restart.id, result);
            }
            if (message.mtb_callback)
                message.mtb_callback.call(message, result, message.getFlag('monks-tokenbar', 'options'));

            return result;
        }
    }

    static async finishRolling(updates, message) {
        if (updates.length == 0) return;

        if (!game.user.isGM) {
            let response = updates.filter(r => { return r.userid == game.userId; });
            if (response.length) {
                MonksTokenBar.emit('finishroll',
                    {
                        type: 'savingthrow',
                        response: response,
                        msgid: message.id
                    }
                );
            }
        } else {
            let flags = {};
            for (let update of updates) {
                let msgtoken = duplicate(message.getFlag('monks-tokenbar', 'token' + update.id));
                msgtoken.reveal = true;
                flags["token" + update.id] = msgtoken;
                log("Finish Rolling", msgtoken);
            }
            message.update({ flags: { 'monks-tokenbar': flags } });
        }
    }

    static async onRollAll(tokentype, message, e) {
        if (game.user.isGM) {
            let flags = message.flags['monks-tokenbar'];
            let tokens = Object.keys(flags)
                .filter(key => key.startsWith('token'))
                .map(key => flags[key]);

            let ids = tokens.filter(t => {
                if (t.roll != undefined) return false;
                let actor = game.actors.get(t.actorid);
                return (actor != undefined && (tokentype == 'all' || actor.type != 'character'));
            }).map(a => a.id);

            return SavingThrow.onRollAbility(ids, message, true, e);
        }
    }

    static async setRollSuccess(tokenid, message, success) {
        //let actors = JSON.parse(JSON.stringify(message.getFlag('monks-tokenbar', 'actors')));
        let msgtoken = duplicate(message.getFlag('monks-tokenbar', 'token' + tokenid)); //actors.find(a => { return a.id == actorid; });

        if (msgtoken.passed === success)
            msgtoken.passed = null;
        else
            msgtoken.passed = success;

        await message.setFlag('monks-tokenbar', 'token' + tokenid, msgtoken);
    }

    static async _onClickToken(tokenId, event) {
        if (event.stopPropagation) event.stopPropagation();
        if (event.preventDefault) event.preventDefault();
        event.cancelBubble = true;
        event.returnValue = false;

        let token = canvas.tokens.get(tokenId);
        let animate = MonksTokenBar.manageTokenControl(token, { shiftKey: event?.originalEvent?.shiftKey });

        return (animate ? canvas.animatePan({ x: token.x, y: token.y }) : true);
    }

    static async onAssignDeathST(tokenId, message, e) {
        if (game.user.isGM) {
            let msgtoken = message.getFlag('monks-tokenbar', 'token' + tokenId);

            if (!msgtoken.assigned) {
                msgtoken = duplicate(msgtoken);

                let actor = game.actors.get(msgtoken.actorid);
                let attr = 'system.attributes.death.' + (msgtoken.passed === true || msgtoken.passed === "success" ? 'success' : 'failure');
                let roll = Roll.fromData(msgtoken.roll);
                let val = (getProperty(actor, attr) || 0) + (roll.dice[0].total == roll.dice[0].options.critical || roll.dice[0].total == roll.dice[0].options.fumble ? 2 : 1);
                let update = {};
                update[attr] = val;
                await actor.update(update);

                msgtoken.assigned = true;
                await message.setFlag('monks-tokenbar', 'token' + tokenId, msgtoken);
            }
        } else {
            MonksTokenBar.emit('assigndeathst',
                {
                    tokenid: tokenId,
                    msgid: message.id
                }
            );

            if (e.stopPropagation) e.stopPropagation();
            if (e.preventDefault) e.preventDefault();
            e.cancelBubble = true;
            e.returnValue = false;
        }
    }
}

/*
Hooks.on("diceSoNiceRollComplete", (messageid) => {
    let message = ui.messages.find(m => m.id == messageid);
    if (message != undefined) {
        if()
    }
})*/

Hooks.on("renderSavingThrowApp", (app, html) => {
    if (app.request == undefined) {
        let request = MonksTokenBar.system.defaultRequest(app) || SavingThrow.lastRequest;
        /*if (!request) {
            request = [];
            $('.request-roll .request-option:first', html).each(function () {
                request.push({ type: this.dataset.type, key: this.dataset.key });
            });
        }*/
        // confirm that the requests are on the list
        if (request) {
            request = request instanceof Array ? request : [request];
            request = request.filter(r => {
                return $(`.request-roll .request-option[data-type="${r.type}"][data-key="${r.key}"]`, html).length;
            });
        }

        app.request = request;
    }

    for (let r of app.request || []) {
        $(`.request-roll .request-option[data-type="${r.type}"][data-key="${r.key}"]`, html).addClass('selected');
    }

    $('.items-header .item-control[data-type="actor"]', html).toggleClass('selected', app.selected === true);
    $('#savingthrow-rollmode', html).val(app.rollmode);
});

Hooks.on("renderChatMessage", async (message, html, data) => {
    const svgCard = html.find(".monks-tokenbar.savingthrow");
    if (svgCard.length !== 0) {
        log('Rendering chat message', message);
        if (!game.user.isGM)
            html.find(".gm-only").remove();
        if (game.user.isGM)
            html.find(".player-only").remove();

        let dc = message.getFlag('monks-tokenbar', 'dc');
        let rollmode = message.getFlag('monks-tokenbar', 'rollmode');
        let requests = message.getFlag('monks-tokenbar', 'requests');
        let request = requests[0];

        $('.roll-all', html).click($.proxy(SavingThrow.onRollAll, SavingThrow, 'all', message));
        $('.roll-npc', html).click($.proxy(SavingThrow.onRollAll, SavingThrow, 'npc', message));

        //let actors = message.getFlag('monks-tokenbar', 'actors');

        let items = $('.item', html);
        let count = 0;
        let groupdc = 0;
        for (let i = 0; i < items.length; i++) {
            var item = items[i];
            let tokenId = $(item).attr('data-item-id');
            let msgtoken = message.getFlag('monks-tokenbar', 'token' + tokenId);//actors.find(a => { return a.id == actorId; });
            if (msgtoken) {
                //let actor = game.actors.get(msgtoken.actorid);
                let tokenOrActor = await fromUuid(msgtoken.uuid);
                let actor = tokenOrActor?.actor ? tokenOrActor.actor : tokenOrActor;

                $(item).toggle(game.user.isGM || rollmode == 'roll' || rollmode == 'gmroll' || (rollmode == 'blindroll' && actor.isOwner));

                if (game.user.isGM || actor?.isOwner)
                    $('.item-image', item).on('click', $.proxy(SavingThrow._onClickToken, this, msgtoken.id))
                $('.item-roll', item).toggle(msgtoken.roll == undefined && (game.user.isGM || (actor.isOwner && rollmode != 'selfroll'))).click($.proxy(SavingThrow.onRollAbility, this, msgtoken.id, message, false));
                $('.dice-total', item).toggle((msgtoken.error === true || msgtoken.roll != undefined) && (game.user.isGM || rollmode == 'roll' || (actor.isOwner && rollmode != 'selfroll')));
                if (msgtoken.roll != undefined && msgtoken.roll.class.includes("Roll")) {
                    //log('Chat roll:', msgtoken.roll);
                    let roll = Roll.fromData(msgtoken.roll);
                    let showroll = game.user.isGM || rollmode == 'roll' || (rollmode == 'gmroll' && actor.isOwner);
                    $('.dice-result', item).toggleClass('reveal', showroll && msgtoken.reveal); //|| (rollmode == 'blindroll' && actor.isOwner)

                    if (msgtoken.reveal && rollmode == 'blindroll' && !game.user.isGM) 
                        $('.dice-result .smoke-screen', item).html(msgtoken.reveal ? '-' : '...');

                    let critpass = (roll.dice.length ? roll.dice[0].total >= roll.dice[0].options.critical : false);
                    let critfail = (roll.dice.length ? roll.dice[0].total <= roll.dice[0].options.fumble : false);

                    if (game.user.isGM || rollmode == 'roll' || rollmode == 'gmroll'){
                        $('.dice-result', item)
                            .toggleClass('success', critpass)
                            .toggleClass('fail', critfail);
                    }

                    if (!msgtoken.reveal && game.user.isGM)
                        $('.dice-result', item).on('click', $.proxy(SavingThrow.finishRolling, SavingThrow, [msgtoken], message));
                    //if (showroll && msgactor.reveal && $('.dice-tooltip', item).is(':empty')) {
                    //    let tooltip = await roll.getTooltip();
                    //    $('.dice-tooltip', item).empty().append(tooltip);
                    //}
                    $('.dice-tooltip', item).toggleClass('noshow', !showroll);
                    $('.result-passed', item)
                        .toggle(request.key != 'init')
                        .toggleClass('recommended', dc != '' && roll.total >= dc)
                        .toggleClass('selected', msgtoken.passed === true || msgtoken.passed === "success")
                        .click($.proxy(SavingThrow.setRollSuccess, this, msgtoken.id, message, true));
                    $('.result-passed i', item).toggleClass("fa-check", msgtoken.passed !== "success").toggleClass("fa-check-double", msgtoken.passed === "success");
                    $('.result-failed', item)
                        .toggle(request.key != 'init')
                        .toggleClass('recommended', dc != '' && roll.total < dc)
                        .toggleClass('selected', msgtoken.passed === false || msgtoken.passed === "failed")
                        .click($.proxy(SavingThrow.setRollSuccess, this, msgtoken.id, message, false));
                    $('.result-failed i', item).toggleClass("fa-times", msgtoken.passed !== "failed").toggleClass("fa-ban", msgtoken.passed === "failed");
                    if (MonksTokenBar.system.useDegrees) {
                        $('.result-passed', item).contextmenu($.proxy(SavingThrow.setRollSuccess, this, msgtoken.id, message, 'success'));
                        $('.result-failed', item).contextmenu($.proxy(SavingThrow.setRollSuccess, this, msgtoken.id, message, 'failed'));
                    }

                    let diceicon = "";
                    let dicetext = "";
                    switch (msgtoken.passed) {
                        case true: diceicon = '<i class="fas fa-check"></i>'; dicetext = i18n("MonksTokenBar.RollPassed");break;
                        case "success": diceicon = '<i class="fas fa-check-double"></i>'; dicetext = i18n("MonksTokenBar.RollCritPassed"); break;
                        case false: diceicon = '<i class="fas fa-times"></i>'; dicetext = i18n("MonksTokenBar.RollFailed"); break;
                        case "failed": diceicon = '<i class="fas fa-ban"></i>'; dicetext = i18n("MonksTokenBar.RollCritFailed"); break;
                    }
                    if (game.user.isGM || rollmode == 'roll')
                        $('.dice-total', item).attr("title", dicetext);
                    $('.dice-text', item)
                        .toggle(showroll && msgtoken.passed != undefined)
                        //.toggleClass('clickable', request.key == 'death' && !msgtoken.assigned)
                        .toggleClass('passed', msgtoken.passed === true || msgtoken.passed === "success")
                        .toggleClass('failed', msgtoken.passed === false || msgtoken.passed === "failed")
                        //.on('click', $.proxy(SavingThrow.onAssignDeathST, this, tokenId, message))
                        .html(diceicon);

                    count++;
                    groupdc += roll.total;
                }
            }

            //if there hasn't been a roll, then show the button if this is the GM or if this token is controlled by the current user

            //if this is the GM, and there's a roll, show the pass/fail buttons
            //highlight a button if the token hasn't had a result selected
            //toggle the button, if a result has been selected

            //if this is not the GM, and the results should be shown, and a result has been selected, then show the result
        };

        //calculate the group DC
        if (count > 0 && request.key != 'init')
            $('.group-dc', html).html(parseInt(groupdc / count));

        //let modename = (rollmode == 'roll' ? 'Public Roll' : (rollmode == 'gmroll' ? 'Private GM Roll' : (rollmode == 'blindroll' ? 'Blind GM Roll' : 'Self Roll')));
        //$('.message-mode', html).html(modename);

        //let content = duplicate(message.content);
        //content = content.replace('<span class="message-mode"></span>', '<span class="message-mode">' + modename + '</span>');
        //await message.update({ "content": content });
        $('.grab-message', html).off('click.grabbing').on('click.grabbing', MonksTokenBar.setGrabMessage.bind(MonksTokenBar, message));

        $('.select-all', html).on('click', $.proxy(MonksTokenBar.selectActors, MonksTokenBar, message, (ti) => ti));
        $('.select-saved', html).on('click', $.proxy(MonksTokenBar.selectActors, MonksTokenBar, message, ti => ti?.passed === true || ti?.passed === "success"));
        $('.select-failed', html).on('click', $.proxy(MonksTokenBar.selectActors, MonksTokenBar, message, ti => ti?.passed === false || ti?.passed === "failed"));
    }
});

/*
Hooks.on("init", () => {
    if (game.system.id == "pf2e") {
        Hooks.on("preCreateChatMessage", (message, option, userid) => {
            if (message?.flags?.pf2e?.context != undefined && (message.flags.pf2e.context?.options?.includes("ignore") || message.flags.pf2e.context.type == 'ignore'))
                return false;
            else
                return true;
        });
    } else if (game.system.id == "sfrpg") {
        Hooks.on("preCreateChatMessage", (message, option, userid) => {
            if (message.flavor == 'removemessage')
                return false;
            else
                return true;
        });
    }
});*/