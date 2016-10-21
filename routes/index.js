const express = require('express');
const vm = require('vm');
const validate = require('jsonschema').validate;
const coffeescript = require('coffee-script');
const typescript = require('typescript');

const config = require('../config');
const httpcode = require('../http-code');

const router = express.Router();
const schema = {
    type: 'object',
    required: ['code', 'context', 'language'],
    properties: {
        code: {
            type: 'string'
        },
        context: {
            type: 'object'
        },
        modules: {
            type: 'array'
        },
        language: {
            enum: config.languages
                .map((language) => { return language.name; })
        }
    }
};


router.post('/', function(request, response) {
    let jsCode = request.body;

    let validatorResult = validate(jsCode, schema);
    if (validatorResult.errors.length > 0) {
        let message = validatorResult.errors.map((error) => {
            return error.stack;
        });

        return response.status(httpcode.BAD_REQUEST).json({
            name: 'ValidationError',
            message: message, stack: null
        });
    }

    let language = config.languages.filter((supportedLanguage) => {
        return supportedLanguage.name === jsCode.language;
    })[0];

    if (!language.enabled) {
        return response.status(httpcode.BAD_REQUEST).json({
            name: 'LanguageError',
            message: `${jsCode.name} is not enabled`,
            stack: null
        });
    }

    try {
        let code = '';
        switch (language.name) {
            case 'javascript':
                code = jsCode.code;
                console.log('language: javascript');
                break;
            case 'coffescript':
                // --bare, without it code will be placed inside wrapper
                // it makes access to context difficult
                code = coffeescript.compile(jsCode.code, {bare: true});
                console.log('language: coffeescript');
                break;
            case 'typescript':
                // remove 'use strict', otherwise javascript will throw an exception about undefined context variable
                code = typescript.transpileModule(jsCode.code, {compilerOptions: {noImplicitUseStrict: true}}).outputText;
                console.log('language: typescript');
                break;
        }

        let compiled = new vm.Script(code, {filename: 'your-code.js', timeout: config.CODE_COMPILE_TIMEOUT_MS});
        let context = new vm.createContext(jsCode.context);

        // import dependencies
        jsCode.modules.forEach(function(moduleName) {
            if (config.modules.hasOwnProperty(moduleName)) {
                let variableName = config.modules[moduleName];
                context[variableName] = require(`${config.MODULES_DIR}/${moduleName}`);
            }
        });

        compiled.runInContext(context, {filename: 'your-code.js', timeout: config.CODE_EXECUTION_TIMEOUT_MS});

        // clear context from imported modules
        jsCode.modules.forEach(function(moduleName) {
            delete context[moduleName];
        });

        console.log('code: \n\t', code);
        console.log('context: \n\t', jsCode.context);
    } catch (error) {
        return response.status(httpcode.BAD_REQUEST).json({
            name: error.name,
            message: error.message,
            stack: error.stack
        });
    }

    console.log('result: \n\t', jsCode.context);
    console.log('--------------------------------------------------');

    response.json({context: jsCode.context});
});

module.exports = router;