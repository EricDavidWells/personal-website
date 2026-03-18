#include <emscripten/bind.h>

#include <algorithm>
#include <cmath>
#include <fstream>
#include <string>
#include <unordered_map>
#include <vector>

#include "generic_ik/kinematics.h"

using namespace emscripten;
using Tree = kinematics::KinematicTree<double>;

Tree load_urdf_from_string(const std::string & urdf_content)
{
  const std::string tmp_path = "/tmp_urdf.xml";
  { std::ofstream f(tmp_path); f << urdf_content; }
  return kinematics::load_from_urdf<double>(tmp_path);
}

// FK returning a flat 16-element column-major array (matches Three.js Matrix4.fromArray)
std::vector<double> fk_flat(Tree & tree, const std::string & link_name)
{
  auto xform = tree.forward_kinematics(link_name);
  std::vector<double> out(16);
  Eigen::Map<Eigen::Matrix4d>(out.data()) = xform.matrix();
  return out;
}

std::vector<double> get_joint_limits(const Tree & tree, const std::string & joint_name)
{
  auto limits = tree.get_limits_by_name(joint_name);
  return {limits.first, limits.second};
}

std::vector<std::string> get_link_names(const Tree & tree)
{
  std::vector<std::string> names;
  for (const auto & node : tree.nodes) {
    if (std::holds_alternative<kinematics::Link>(node)) {
      names.push_back(kinematics::get_name<double>(node));
    }
  }
  return names;
}

struct JointInfo
{
  std::string name;
  std::string parent_link;
  std::string child_link;
  std::string type;
  double lower_limit;
  double upper_limit;
  std::vector<double> axis;  // 3 elements: x, y, z
  std::vector<double> origin_xyz;  // 3 elements: x, y, z translation
  std::vector<double> origin_rpy;  // 3 elements: roll, pitch, yaw rotation
};

struct ManipulabilityResultJS {
  double w_pos;
  double w_ori;
  std::vector<double> pos_axes;   // 9 elements: column-major flattened 3x3
  std::vector<double> pos_values; // 3 elements: semi-axis lengths (meters)
  std::vector<double> ori_axes;   // 9 elements: column-major flattened 3x3
  std::vector<double> ori_values; // 3 elements: dimensionless
};

std::vector<JointInfo> get_joint_info(const Tree & tree)
{
  std::vector<JointInfo> info;
  for (size_t i = 0; i < tree.nodes.size(); i++) {
    const auto & node = tree.nodes[i];
    std::string type;
    std::vector<double> axis = {0, 0, 1};  // Default axis
    std::vector<double> origin_xyz = {0, 0, 0};
    std::vector<double> origin_rpy = {0, 0, 0};

    std::visit(
      [&type, &axis, &origin_xyz, &origin_rpy](const auto & obj) {
        using T = std::decay_t<decltype(obj)>;
        if constexpr (std::is_same_v<T, kinematics::RevoluteJoint<double>>) {
          type = "revolute";
          axis = {obj.axis[0], obj.axis[1], obj.axis[2]};
          origin_xyz = {obj.fixed_xform.translation()[0], obj.fixed_xform.translation()[1], obj.fixed_xform.translation()[2]};
          // Extract Euler angles from rotation matrix (ZYX convention)
          auto rot_mat = obj.fixed_xform.rotation();
          double roll = std::atan2(rot_mat(2,1), rot_mat(2,2));
          double pitch = std::atan2(-rot_mat(2,0), std::sqrt(rot_mat(2,1)*rot_mat(2,1) + rot_mat(2,2)*rot_mat(2,2)));
          double yaw = std::atan2(rot_mat(1,0), rot_mat(0,0));
          origin_rpy = {roll, pitch, yaw};
        }
        else if constexpr (std::is_same_v<T, kinematics::ContinuousJoint<double>>) {
          type = "continuous";
          axis = {obj.axis[0], obj.axis[1], obj.axis[2]};
          origin_xyz = {obj.fixed_xform.translation()[0], obj.fixed_xform.translation()[1], obj.fixed_xform.translation()[2]};
          auto rot_mat = obj.fixed_xform.rotation();
          double roll = std::atan2(rot_mat(2,1), rot_mat(2,2));
          double pitch = std::atan2(-rot_mat(2,0), std::sqrt(rot_mat(2,1)*rot_mat(2,1) + rot_mat(2,2)*rot_mat(2,2)));
          double yaw = std::atan2(rot_mat(1,0), rot_mat(0,0));
          origin_rpy = {roll, pitch, yaw};
        }
        else if constexpr (std::is_same_v<T, kinematics::PrismaticJoint<double>>) {
          type = "prismatic";
          axis = {obj.axis[0], obj.axis[1], obj.axis[2]};
          origin_xyz = {obj.fixed_xform.translation()[0], obj.fixed_xform.translation()[1], obj.fixed_xform.translation()[2]};
          auto rot_mat = obj.fixed_xform.rotation();
          double roll = std::atan2(rot_mat(2,1), rot_mat(2,2));
          double pitch = std::atan2(-rot_mat(2,0), std::sqrt(rot_mat(2,1)*rot_mat(2,1) + rot_mat(2,2)*rot_mat(2,2)));
          double yaw = std::atan2(rot_mat(1,0), rot_mat(0,0));
          origin_rpy = {roll, pitch, yaw};
        }
        else if constexpr (std::is_same_v<T, kinematics::FixedJoint<double>>)
          type = "fixed";
      },
      node);

    if (type.empty()) continue;

    std::string name = kinematics::get_name<double>(node);

    std::string parent_link;
    auto parent_idx = tree.get_parent_index(i);
    if (parent_idx) {
      parent_link = kinematics::get_name<double>(tree.nodes[parent_idx.value()]);
    }

    std::string child_link;
    auto children = tree.get_children_indices(i);
    if (!children.empty()) {
      child_link = kinematics::get_name<double>(tree.nodes[children[0]]);
    }

    double lower = 0, upper = 0;
    if (type != "fixed") {
      auto limits = tree.get_limits_by_name(name);
      lower = limits.first;
      upper = limits.second;
    }

    info.push_back({name, parent_link, child_link, type, lower, upper, axis, origin_xyz, origin_rpy});
  }
  return info;
}

double get_position_manipulability(
    const Tree& tree,
    const std::string& tip_name,
    const std::string& base_name,
    const std::vector<std::string>& joint_names)
{
    auto manip = tree.manipulability(tip_name, base_name, joint_names);
    return manip.w_pos;  // Return position manipulability only
}

ManipulabilityResultJS get_manipulability(
    const Tree& tree,
    const std::string& tip_name,
    const std::string& base_name,
    const std::vector<std::string>& joint_names)
{
  auto manip = tree.manipulability(tip_name, base_name, joint_names);

  ManipulabilityResultJS result;
  result.w_pos = manip.w_pos;
  result.w_ori = manip.w_ori;

  // Flatten pos_axes (column-major: col0, col1, col2)
  result.pos_axes.resize(9);
  for (int col = 0; col < 3; col++) {
    for (int row = 0; row < 3; row++) {
      result.pos_axes[col * 3 + row] = manip.pos_axes(row, col);
    }
  }

  result.pos_values.resize(3);
  for (int i = 0; i < 3; i++) {
    result.pos_values[i] = manip.pos_values[i];
  }

  result.ori_axes.resize(9);
  for (int col = 0; col < 3; col++) {
    for (int row = 0; row < 3; row++) {
      result.ori_axes[col * 3 + row] = manip.ori_axes(row, col);
    }
  }

  result.ori_values.resize(3);
  for (int i = 0; i < 3; i++) {
    result.ori_values[i] = manip.ori_values[i];
  }

  return result;
}

EMSCRIPTEN_BINDINGS(kinematics_module)
{
  register_vector<std::string>("StringVector");
  register_vector<double>("DoubleVector");

  value_object<JointInfo>("JointInfo")
    .field("name", &JointInfo::name)
    .field("parentLink", &JointInfo::parent_link)
    .field("childLink", &JointInfo::child_link)
    .field("type", &JointInfo::type)
    .field("lowerLimit", &JointInfo::lower_limit)
    .field("upperLimit", &JointInfo::upper_limit)
    .field("axis", &JointInfo::axis)
    .field("originXyz", &JointInfo::origin_xyz)
    .field("originRpy", &JointInfo::origin_rpy);

  register_vector<JointInfo>("JointInfoVector");

  value_object<ManipulabilityResultJS>("ManipulabilityResult")
    .field("wPos", &ManipulabilityResultJS::w_pos)
    .field("wOri", &ManipulabilityResultJS::w_ori)
    .field("posAxes", &ManipulabilityResultJS::pos_axes)
    .field("posValues", &ManipulabilityResultJS::pos_values)
    .field("oriAxes", &ManipulabilityResultJS::ori_axes)
    .field("oriValues", &ManipulabilityResultJS::ori_values);

  class_<Tree>("KinematicTree")
    .constructor<>()
    .function("getActiveJointNames", &Tree::get_active_joint_names)
    .function("updateTheta",
      select_overload<void(const std::string &, double)>(&Tree::update_theta_by_name))
    .function("getTheta", &Tree::get_theta_by_name);

  function("loadUrdfFromString", &load_urdf_from_string);
  function("fkFlat", &fk_flat);
  function("getJointLimits", &get_joint_limits);
  function("getLinkNames", &get_link_names);
  function("getJointInfo", &get_joint_info);
  function("getPositionManipulability", &get_position_manipulability);
  function("getManipulability", &get_manipulability);
}
