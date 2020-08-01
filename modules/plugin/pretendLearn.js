const mongodb = require('mongodb').MongoClient;

const db_path = "mongodb://127.0.0.1:27017";
var replyFunc = (context, msg, at = false) => {console.log(msg)};
let logger;

function learnReply(replyMsg, main_logger) {
    replyFunc = replyMsg;
    logger = main_logger;
}

function replaceImg(img) {
    return img.replace(/\[CQ:image,file=.+,url=(.+)\]/ig, '[CQ:image,file=$1]');
}

/**
 * 教学环节
 * @param {object} context
 */
function teach(context) {
    let qa_with_mode = RegExp(/我教你\s?(?<qes>.+?)\s?[＞>]\s?(?<ans>.+?)\s?[＞>]\s?(?<mode_name>精确|模糊|正则)/i);
    let qa_common = RegExp(/我教你\s?(?<qes>.+?)\s?[＞>]\s?(?<ans>.+)/i);
    
    let result = context.message.match(qa_with_mode);
    if (result == undefined) {
        result = context.message.match(qa_common);
    }
    if (result != null) {
        let {groups : {qes, ans, mode_name}} = result;

        let text = "";
        let {err, error_text, mode} = check(qes, mode_name);

        //如果没有错误就写入数据库
        if (!err) {
            mongodb(db_path, {useUnifiedTopology: true}).connect().then(async (mongo) => {
                if (/\[CQ:image/.test(qes)) qes = replaceImg(qes);
                if (/\[CQ:image/.test(ans)) ans = replaceImg(ans);
                let qa_set = mongo.db('qa_set').collection("qa" + String(context.group_id));
                await qa_set.updateOne({question : qes, mode : mode}, {$set : {count : 0}, $addToSet : {answers : ans}}, {upsert : true});
                mongo.close();
            }).catch((e) => {console.error(e)});
            text = "好我会了";
        }
        else text = error_text;

        replyFunc(context, text);
        return true;
    }
    else return false;
}

/**
 * 教学环节
 * @param {object} context
 */
function record(context) {
    let repeat_with_mode = RegExp(/(?<!不准)复读\s?(?<repeat_word>.+?)\s?[＞>]\s?(?<mode_name>精确|模糊|正则)/);
    let rp_common = RegExp(/(?<!不准)复读\s?(?<repeat_word>.+)/);
    
    let result = context.message.match(repeat_with_mode);
    if (result == undefined) {
        result = context.message.match(rp_common);
    }

    if (result != null) {
        let {groups : {repeat_word, mode_name}} = result;
        let text = "";
        let {err, error_text, mode} = check(repeat_word, mode_name);

        if (!err) {
            mongodb(db_path, {useUnifiedTopology: true}).connect().then(async (mongo) => {
                if (/\[CQ:image/.test(repeat_word)) repeat_word = replaceImg(repeat_word);
                let rp_set = mongo.db('qa_set').collection("repeat" + String(context.group_id));
                await rp_set.updateOne({repeat_word : repeat_word}, {$set : {mode : mode, count : 0}}, {upsert : true});
                mongo.close();
            }).catch((err) => {console.error(err)});
            text = "复读机已就位：" + repeat_word;
        }
        else text = error_text;
        replyFunc(context, text);
        return true;
    }
    else return false;
}

//匹配模式选择
function check(word, mode_name) {
    let text = "";
    let err = false;
    let mode = "exact";

    if (mode_name != undefined) {
        switch (mode_name) {
            case "精确": 
                if (word.length < 2) {
                    err = true;
                    text = "太短了";
                } 
                break;
            case "模糊": 
                mode = "fuzzy";
                if (word.length < 2) {
                    err = true;
                    text = "太短了";
                }
                break;
            case "正则": 
                mode = "regexp"; 
                //处理CQ自带的转义
                word = word.replace("&amp;", "&").replace("&#91;", "[").replace("&#93;", "]");
                let test_reg = word.replace(/"[CQ:.+?]"/g, "");
                if (!/[\[\]\^\$\\d\\w\\s\\b\.\{\}\|]/i.test(test_reg)) {
                    text = "吾日三省吾身\n1. 我真的会正则吗？\n2. 精确和模糊不够用，必须要正则吗？\n3. 这正则写对了吗？";
                    err = true;
                    break;
                }
                else try {
                    new RegExp(word);
                } catch(err) {
                    err = true;
                    text = "正则都写错了，重修去吧";
                } finally {
                    break;
                }
            default : 
            err = true;
                text = "哇你会不会写啊？";
                break;
        }
    }
    //如果没有指定模式，使用这里的配置
    else {
        if (word.length < 2) {
            err = true;
            text = "太短了";
        }
        else if (word.length < 5 && !/^[0-9]{1,3}$/.test(word)) mode = "fuzzy";
        else mode = "exact";
    }
    return {err : err, error_text : text, mode : mode};
}

function remember(context) {
    let common = new RegExp(/\s?(?:想一?想|回忆)\s?(?<ans>.+)/i);
    let specific = new RegExp(/\s?(?:想一?想|回忆)\s?(?<ans>.+?)\s?[＞>]\s?(?<mode_name>精确|模糊|正则)/i);

    let match_result = context.message.match(specific);
    if (match_result == undefined) {
        match_result = context.message.match(common);
    }

    if (match_result != null) {
        let {groups : {ans, mode_name}} = match_result;
        let text = "";
        let result = "";
        let mode = "exact";
        if (/\[CQ:image/.test(ans)) ans = replaceImg(ans);

        mongodb(db_path, {useUnifiedTopology: true}).connect().then(async mongo => {
            let coll = mongo.db('qa_set').collection("qa" + String(context.group_id));

            if (mode_name != undefined) {
                switch (mode_name) {
                    case "精确": mode = "exact";
                    case "模糊": mode = "fuzzy";
                    case "正则": mode = "regexp";
                }
                result = await coll.find({answers : ans, mode : mode}).toArray();
            }
            else result = await coll.find({answers : ans}).toArray();
            mongo.close();

            if (result.length < 1) text = "从来没学过啊";
            else {
                let qes_and_mode = [];
                let mode_name = "";
                result.forEach(element => {
                    switch (element.mode) {
                        case "exact": mode_name = "精确"; break;
                        case "fuzzy": mode_name = "模糊"; break;
                        case "regexp": mode_name = "正则"; break;
                        default: mode_name = "不明"; break;
                    }
                    qes_and_mode.push(`${element.question}，模式为${mode_name}`);
                });
                let result_text = qes_and_mode.join("\n");
                text = `我想想，我有学过\n${result_text}`;
            }
            if (/\[CQ:image/.test(text)) text = replaceImg(text);
            replyFunc(context, text)
        }).catch((err) => {console.log(err)});
        return true;
    }
    else return false;
}

function rememberAll(context) {
    let common = new RegExp(/\s?你学过什么/);
    let match_result = context.message.match(common);

    if (match_result != null) {
        mongodb(db_path, {useUnifiedTopology: true}).connect().then(async mongo => {
            let qa_set = mongo.db('qa_set').collection("qa" + String(context.group_id));
            let qa_result = await qa_set.find({}).toArray();
            let rp_set = mongo.db('qa_set').collection("repeat" + String(context.group_id));
            let rp_result = await rp_set.find({}).toArray();
            let text = [];
            mongo.close();

            if (qa_result.length < 1 && rp_result.length < 1) text = "脑袋空空的啊";
            else {
                if (qa_result.length >= 1) text.push("回应：\n" + fmtColl(qa_result, "qa"));
                if (rp_result.length >= 1) text.push("复读：\n" + fmtColl(rp_result, "rp"));
            }
            
            replyFunc(context, "我想想，我有学过\n" + text.join('\n'));
            return true;
        }).catch((err) => {console.error(err)});
    }
    else return false;

    function fmtColl(collection, set) {
        let word_and_mode = [];
        let mode_name = "";
        let word = "";

        collection.forEach(element => {
            switch (element.mode) {
                case "exact": mode_name = "精确"; break;
                case "fuzzy": mode_name = "模糊"; break;
                case "regexp": mode_name = "正则"; break;
                default: mode_name = "不明"; break;
            }
            if (set == "qa") word = element.question;
            else word = element.repeat_word;
            if (/\[CQ:image/.test(word)) word = replaceImg(word);
            word_and_mode.push(`${word}，模式为${mode_name}`);
        });
        let result_text = word_and_mode.join("\n");
        return result_text;
    }
}

function rank(context) {
    mongodb(db_path, {useUnifiedTopology: true}).connect().then(async mongo => {
        let qa_set = mongo.db('qa_set').collection("qa" + String(context.group_id));
        let qa_result = await qa_set.find({}).toArray();
        let rp_set = mongo.db('qa_set').collection("repeat" + String(context.group_id));
        let rp_result = await rp_set.find({}).toArray();
        let text = [];
        mongo.close();

        if (qa_result.length < 1 && rp_result.length < 1) text.push("脑袋空空的啊");
        else {
            if (qa_result.length > 1) {
                qa_result.sort((a, b) => {
                    a.count = (a.count == undefined) ? 0 : a.count;
                    b.count = (b.count == undefined) ? 0 : b.count;
                    return b.count - a.count;
                });
                text.push(['问答词排名', rankText(qa_result)].join('\n'));
            }

            if (rp_result.length > 1) {
                rp_result.sort((a, b) => {
                    a.count = (a.count == undefined) ? 0 : a.count;
                    b.count = (b.count == undefined) ? 0 : b.count;
                    return a.count - b.count;
                });
                text.push(['复读词排名', rankText(rp_result)].join('\n'));
            }
            
            function rankText(sorted) {
                let rank_list = [];
                for (let i = 0; i < ((sorted.length >= 5) ? 5 : sorted.length); i++) {
                    rank_list.push(`${('question' in sorted[i]) ? sorted[i].question : sorted[i].repeat_word}，${('count' in sorted[i]) ? sorted[i].count : 0}次`);
                }
                return rank_list.join('\n');
            }
        }
        text = text.join('\n\n');
        if (/\[CQ:image/.test(text)) text = replaceImg(text);
        replyFunc(context, text);
    }).catch((err) => {console.error(err)});
}

function forget(context) {
    let common = new RegExp(/\s?(?:忘记|忘掉)\s?(?<qes>.+)/);
    let specific = new RegExp(/\s?(?:忘记|忘掉)\s?(?<qes>.+?)\s?[＞>]\s?(?<mode_name>精确|模糊|正则)/);

    let match_result = context.message.match(specific);
    if (match_result == undefined) match_result = context.message.match(common);

    if (match_result != null) {
        let {groups : {qes, mode_name}} = match_result;
        let text = "";
        let result = "";
        let mode = "exact";
        if (/\[CQ:image/.test(qes)) qes = replaceImg(qes);

        mongodb(db_path, {useUnifiedTopology: true}).connect().then(async mongo => {
            let coll = mongo.db('qa_set').collection("qa" + String(context.group_id));

            if (mode_name != undefined) {
                switch (mode_name) {
                    case "精确": mode = "exact";
                    case "模糊": mode = "fuzzy";
                    case "正则": mode = "regexp";
                }
                if (mode == "regexp" && !(/^([?/.+*]|\.\*)$/.test(qes))) {
                    let reg_exp = new RegExp(qes);
                    result = await coll.findOneAndDelete({question : reg_exp, mode : mode});
                }
                else result = await coll.findOneAndDelete({question : qes, mode : mode});
            }
            else result = await coll.findOneAndDelete({question : qes});
            if (result.value == null) text = "我都还没记住呢";
            else text = `我已经完全忘记了${replaceImg(result.value.question)}和它的${result.value.answers.length}个回应`;

            replyFunc(context, text);
            mongo.close();
        }).catch((err) => {console.log(err)});
        return true;
    }
    else return false;
}

function erase(context) {
    let common = new RegExp(/不准复读\s?(?<repeat_word>.+)/);
    let match_result = context.message.match(common);

    if (match_result != null) {
        let {groups : {repeat_word}} = match_result;
        let text = "";
        if (/\[CQ:image/.test(repeat_word)) repeat_word = replaceImg(repeat_word);
        
        mongodb(db_path, {useUnifiedTopology: true}).connect().then(async mongo => {
            let coll = mongo.db('qa_set').collection("repeat" + String(context.group_id));
            let result = await coll.findOneAndDelete({repeat_word : repeat_word});

            if (result.value == null) text = "我都还没记住呢";
            else text = `记录已抹去：${replaceImg(result.value.repeat_word)}`;
            replyFunc(context, text);
            mongo.close();
        }).catch((err) => {console.log(err)});
        return true;
    }
    else return false;
}

async function reply(context) {
    return mongodb(db_path, {useUnifiedTopology: true}).connect().then(async mongo => {
        let coll = mongo.db('qa_set').collection("qa" + String(context.group_id));
        let order = ["exact", "regexp", "fuzzy"];
        
        let result = [];
        let answers = [];
        let reg_exp = "";
        let cplt_flag = false;
        let match = {};
        let message = replaceImg(context.message);

        //按照order的顺序，循环检测匹配项
        for (let i = 0; i < order.length; i++) {
            result = await coll.find({mode : order[i]}).toArray();
            if (result != null) {
                for (let j = 0; j < result.length; j++) {
                    switch (result[j].mode) {
                        case "exact": {
                            if (message == result[j].question) cplt_flag = true;
                            break;
                        }
                        case "fuzzy": {
                            if (message.split(result[j].question).length > 1) cplt_flag = true;
                            break;
                        }
                        case "regexp": {
                            reg_exp = new RegExp(result[j].question);
                            if (reg_exp.test(message)) cplt_flag = true;
                            break;
                        }
                    }
                    if (cplt_flag) {
                        match = result[j];
                        break;
                    }
                }
            }
            if (cplt_flag) break;
        }
        
        if (cplt_flag) {
            answers = match.answers;
            let rand = Math.floor(Math.random() * answers.length);
            let text = replaceImg(answers[rand]);
            replyFunc(context, text);
            await coll.findOneAndUpdate({_id : match._id}, {$inc: {count : 1}});
            mongo.close();
            return true;
        }
        else {
            mongo.close();
            return false;
        }
    }).catch((err) => {console.error(err)});
}

function repeat(context) {
    mongodb(db_path, {useUnifiedTopology: true}).connect().then(async mongo => {
        let coll = mongo.db('qa_set').collection("repeat" + String(context.group_id));
        let order = ["exact", "regexp", "fuzzy"];
        
        let result = [];
        let reg_exp = "";
        let flag = false;
        let match = {};
        let message = replaceImg(context.message);

        //按照order的顺序，循环检测匹配项
        for (let i = 0; i < order.length; i++) {
            result = await coll.find({mode : order[i]}).toArray();
            if (result != null) {
                for (let j = 0; j < result.length; j++) {
                    switch (result[j].mode) {
                        case "exact": {
                            if (message == result[j].repeat_word) flag = true;
                            break;
                        }
                        case "fuzzy": {
                            if (message.indexOf(result[j].repeat_word) != -1) flag = true;
                            break;
                        }
                        case "regexp": {
                            reg_exp = new RegExp(result[j].repeat_word);
                            if (reg_exp.test(message)) flag = true;
                            break;
                        }
                    }
                    if (flag) {
                        match = result[j];
                        break;
                    }
                }
            }
            if (flag) break;
        }
        if (flag == true && !logger.repeater[context.group_id].done) {
            logger.rptDone(context.group_id);
            replyFunc(context, context.message);
            await coll.findOneAndUpdate({_id : match._id}, {$inc: {count : 1}});
        }
        mongo.close();
        return;
    }).catch((err) => {console.error(err)});
}

function talk(context) {
    reply(context).then(result => {
        if (!result) repeat(context);
    });
}

function learn(context) {
    if ("group_id" in context) {
        if (teach(context)) return true;
        else if (record(context)) return true;
        else if (forget(context)) return true;
        else if (erase(context)) return true;
        else if (remember(context)) return true;
        else if (/owner|admin/.test(context.sender.role) && /教学成果/.test(context.message)) {
            rank(context);
            return true;
        }
        else if (/owner|admin/.test(context.sender.role) && /你学过什么/.test(context.message)) {
            rememberAll(context);
            return true
        }
        else return false;
    }
    else return false;
}

module.exports = {learn, talk, learnReply};
