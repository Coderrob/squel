'use strict';

squel.flavours['cosmosdb'] = function (_squel) {
    let cls = _squel.cls;

    cls.DefaultQueryBuilderOptions.parameterCharacter = '@';
    cls.DefaultQueryBuilderOptions.replaceSingleQuotes = true;
    cls.DefaultQueryBuilderOptions.autoQuoteAliasNames = false;
    cls.DefaultQueryBuilderOptions.numberedParameters = true;
    cls.DefaultQueryBuilderOptions.numberedParametersPrefix = '@';

    function _extend(dst, ...sources) {
        if (dst && sources) {
            for (let src of sources) {
                if (typeof src === 'object') {
                    Object.getOwnPropertyNames(src).forEach(function (key) {
                        dst[key] = src[key];
                    });
                }
            }
        }

        return dst;
    }

    _squel.registerValueHandler(Date, function (date) {
        return `'${date.getUTCFullYear()}-${date.getUTCMonth() + 1}-${date.getUTCDate()} ${date.getUTCHours()}:${date.getUTCMinutes()}:${date.getUTCSeconds()}'`;
    });

    // TOP x
    cls.CosmosdbTopBlock = class extends cls.AbstractVerbSingleValueBlock {
        constructor(options) {
            super(_extend({}, options, {
                verb: 'TOP'
            }));
        }

        top(max) {
            this._setValue(max);
        }
    };

    cls.CosmosdbValueAndGetFieldBlock = class extends cls.GetFieldBlock {
        constructor(options) {
            super(options);
            this.isValueOperation = false;
            this.baseToParamString = super._toParamString;
        }

        value(field) {
            this._fields = [];
            this.isValueOperation = true;
            this.field(field);
        }

        _toParamString(options = {}) {
            let params = this.baseToParamString(options);

            if (this.isValueOperation) {
                params.text = 'VALUE ' + params.text;
            }

            return params;
        }
    };

    // SELECT query builder.
    cls.Select = class extends cls.QueryBuilder {
        constructor(options, blocks = null) {
            blocks = blocks || [
                new cls.StringBlock(options, 'SELECT'),
                new cls.CosmosdbTopBlock(options),
                new cls.CosmosdbValueAndGetFieldBlock(options),
                new cls.FromTableBlock(options),
                new cls.JoinBlock(options),
                new cls.WhereBlock(options),
                new cls.OrderByBlock(options)
            ];

            super(options, blocks);

            this.toString = function (options = {}) {
                return this._toParamString(options).query;
            };
        }

        // Get the final fully constructed query param obj.
        _toParamString(options = {}) {
            options = _extend({}, this.options, options);

            let blockResults = this.blocks.map((b) => b._toParamString({
                buildParameterized: options.buildParameterized,
                queryBuilder: this,
            }));

            let blockTexts = blockResults.map((b) => b.text || '');
            let blockValues = blockResults.map((b) => b.values || []);

            let totalStr = blockTexts
                .filter((v) => (0 < v.length))
                .join(options.separator);

            let totalValues = [];
            let index = (undefined !== options.numberedParametersStartAt)
                ? options.numberedParametersStartAt
                : 1;

            blockValues.forEach(block =>
                block.forEach(value =>
                    totalValues.push({
                        'name': `${options.numberedParametersPrefix}param${index++}`,
                        'value': value
                    })));

            if (!options.nested) {
                if (options.numberedParameters) {
                    let i = (undefined !== options.numberedParametersStartAt)
                        ? options.numberedParametersStartAt
                        : 1;

                    // construct regex for searching
                    const regex = options.parameterCharacter.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');

                    totalStr = totalStr.replace(
                        new RegExp(regex, 'g'),
                        function () {
                            return `${options.numberedParametersPrefix}param${i++}`;
                        }
                    );
                }
            }

            return {
                query: this._applyNestingFormatting(totalStr, !!options.nested),
                parameters: totalValues,
            };
        }
    }
}
