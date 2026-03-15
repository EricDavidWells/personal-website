cmake_minimum_required(VERSION 3.16)
project(kinematics_wasm)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Paths to header-only dependencies
set(KINEMATICS_INCLUDE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../vendor/generic-numerical-inverse-kinematics/generic-numerical-inverse-kinematics/include")
set(EIGEN_INCLUDE_DIR "/usr/include/eigen3")
set(DEPS_INCLUDE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/deps")

add_executable(kinematics kinematics_bindings.cpp)

target_compile_definitions(kinematics PRIVATE FMT_HEADER_ONLY=1)

target_include_directories(kinematics PRIVATE
  ${KINEMATICS_INCLUDE_DIR}
  ${EIGEN_INCLUDE_DIR}
  ${DEPS_INCLUDE_DIR}
)

set_target_properties(kinematics PROPERTIES
  SUFFIX ".js"
  LINK_FLAGS "\
    --bind \
    -s MODULARIZE=1 \
    -s EXPORT_NAME='KinematicsModule' \
    -s EXPORT_ES6=1 \
    -s FORCE_FILESYSTEM=1 \
    -s EXPORTED_RUNTIME_METHODS=['FS'] \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s ENVIRONMENT='web' \
    -O2 \
  "
)
