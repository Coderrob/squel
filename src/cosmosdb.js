squel.flavours['cosmosdb'] = function (_squel) {
    let cls = _squel.cls;

    cls.DefaultQueryBuilderOptions.parameterCharacter = '@';
    cls.DefaultQueryBuilderOptions.replaceSingleQuotes = true;
    cls.DefaultQueryBuilderOptions.autoQuoteAliasNames = false;
    cls.DefaultQueryBuilderOptions.numberedParameters = true;
    cls.DefaultQueryBuilderOptions.numberedParametersPrefix = '@';

    _squel.registerValueHandler(Date, function (date) {
        return `'${date.getUTCFullYear()}-${date.getUTCMonth() + 1}-${date.getUTCDate()} ${date.getUTCHours()}:${date.getUTCMinutes()}:${date.getUTCSeconds()}'`;
    });

    // TOP x
    cls.CosmosdbTopBlock = class extends cls.Block {
        constructor(options) {
            super(options);
            this._limits = null;

            let _limit = function (max) {
                max = this._sanitizeLimitOffset(max);
                this._parent._limits = max;
            };

            this.ParentBlock = class extends cls.Block {
                constructor(parent) {
                    super(parent.options);
                    this._parent = parent;
                }
            };

            this.TopBlock = class extends this.ParentBlock {
                constructor(parent) {
                    super(parent);
                    this.top = _limit;
                }

                _toParamString() {
                    let str = '';
                    if (this._parent._limits && !this._parent._offsets) {
                        str = `TOP (${this._parent._limits})`;
                    }
                    return {
                        query: str,
                        parameters: [],
                    }
                }
            };
        }

        TOP() {
            return new this.TopBlock(this);
        }
    };

    // SELECT query builder.
    cls.Select = class extends cls.QueryBuilder {
        constructor(options, blocks = null) {
            blocks = blocks || [
                new cls.StringBlock(options, 'SELECT'),
                new cls.DistinctBlock(options),
                new cls.CosmosdbTopBlock(options).TOP(),
                new cls.GetFieldBlock(options),
                new cls.FromTableBlock(options),
                new cls.JoinBlock(options),
                new cls.WhereBlock(options),
                new cls.OrderByBlock(options)
            ];

            super(options, blocks);

            this._extend = function (dst, ...sources) {
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
            };
        }

        // Get the final fully constructed query param obj.
        _toParamString(options = {}) {
            options = this._extend({}, this.options, options);

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
                        'name': `${options.numberedParametersPrefix}${index++}`,
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
                            return `${options.numberedParametersPrefix}${i++}`;
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