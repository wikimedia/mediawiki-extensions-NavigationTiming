/* eslint-env node */
module.exports = function ( grunt ) {
	grunt.loadNpmTasks( 'grunt-banana-checker' );
	grunt.loadNpmTasks( 'grunt-eslint' );
	grunt.loadNpmTasks( 'grunt-jsonlint' );

	grunt.initConfig( {
		jsonlint: {
			all: [
				'**/*.json',
				'!node_modules/**'
			]
		},
		banana: {
			all: 'i18n/'
		},
		eslint: {
			all: [ '*.js', '{modules,tests}/**/*.js' ]
		}
	} );

	grunt.registerTask( 'test', [ 'jsonlint', 'banana', 'eslint' ] );
	grunt.registerTask( 'default', 'test' );
};
